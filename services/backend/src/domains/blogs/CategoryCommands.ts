import {
  Authorized,
  type CategoryName,
  categorySlugOf,
} from "@unhalteproblem.de/api";
import { Context, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { actorIdOf, UserDirectory } from "#domains/users/UserDirectory";
import { isUniqueViolation } from "#infrastructure/Columns";
import {
  CategoryInUse,
  CategoryMergeIntoSelf,
  CategoryNameTaken,
  CategoryNotFound,
  CategoryRow,
  type CategorySlug,
  categorySlugConstraint,
} from "./Category.ts";
import {
  CategoryRepository,
  type CategorySummary,
} from "./CategoryRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* CategoryRepository;
  const users = yield* UserDirectory;
  const audit = yield* AuditCommands;
  const transaction = yield* Transaction;

  const actorOf = (proof: { readonly user: { readonly id: string } }) =>
    actorIdOf(proof).pipe(Effect.provideService(UserDirectory, users));

  /** The category, locked against every use until the transaction ends. */
  const lock = Effect.fnUntraced(function* (category: CategorySlug) {
    const row = yield* repository.findBySlug(category, { lock: true });
    if (Option.isNone(row)) return yield* new CategoryNotFound({ category });
    return row.value;
  });

  const summaryOf = Effect.fnUntraced(function* (category: CategorySlug) {
    const summary = yield* repository.findSummary(category);
    if (Option.isNone(summary)) {
      return yield* Effect.die(
        new Error("Category vanished inside its transaction"),
      );
    }
    return summary.value;
  });

  return CategoryCommands.of({
    renameCategory: Effect.fn("CategoryCommands.renameCategory")(function* (
      category: CategorySlug,
      name: CategoryName,
    ) {
      const actor = yield* actorOf(yield* Authorized("admin"));
      const row = yield* lock(category);
      const slug = categorySlugOf(name);
      // The slug follows the name; one that belongs to another category
      // would merge them, which is `mergeCategory`'s job.
      yield* transaction
        .run(repository.update(CategoryRow.make({ ...row, slug, name })))
        .pipe(
          Effect.catchIf(isUniqueViolation(categorySlugConstraint), () =>
            Effect.fail(new CategoryNameTaken({ category: slug })),
          ),
        );
      yield* audit.record({
        action: "category_renamed",
        actor: Option.some(actor),
        target: Option.none(),
        detail: slug,
      });
      return yield* summaryOf(slug);
    }, Command.boundary(transaction)),

    mergeCategory: Effect.fn("CategoryCommands.mergeCategory")(function* (
      category: CategorySlug,
      into: CategorySlug,
    ) {
      const actor = yield* actorOf(yield* Authorized("admin"));
      if (category === into) {
        return yield* new CategoryMergeIntoSelf({ category });
      }
      // Always lock in slug order, so two opposite merges can't deadlock.
      const [first, second] =
        category < into ? [category, into] : [into, category];
      const firstRow = yield* lock(first);
      const secondRow = yield* lock(second);
      const [source, target] =
        first === category ? [firstRow, secondRow] : [secondRow, firstRow];
      yield* repository.merge(source.id, target.id);
      yield* audit.record({
        action: "category_merged",
        actor: Option.some(actor),
        target: Option.none(),
        detail: category,
      });
      return yield* summaryOf(into);
    }, Command.boundary(transaction)),

    deleteCategory: Effect.fn("CategoryCommands.deleteCategory")(function* (
      category: CategorySlug,
    ) {
      const actor = yield* actorOf(yield* Authorized("admin"));
      const row = yield* lock(category);
      // The lock keeps new uses out, so the count is final.
      const usage = yield* repository.usage(row.id);
      if (usage.blogCount > 0 || usage.postCount > 0) {
        return yield* new CategoryInUse(usage);
      }
      yield* repository.delete(row.id);
      yield* audit.record({
        action: "category_deleted",
        actor: Option.some(actor),
        target: Option.none(),
        detail: category,
      });
    }, Command.boundary(transaction)),
  });
});

/**
 * The admins' cleanup of categories (`Authorized("admin")`). Editors create
 * categories by using them, in `BlogCommands`.
 *
 * @effect-expect-leaking Authorized<"admin">
 * Requiring the proof in every method is the point: whoever calls one
 * must have checked the role (see docs/authorization.md).
 */
export class CategoryCommands extends Context.Service<
  CategoryCommands,
  {
    /** Renames it; its slug becomes the one derived from the new name. */
    readonly renameCategory: (
      category: CategorySlug,
      name: CategoryName,
    ) => Effect.Effect<
      CategorySummary,
      CategoryNotFound | CategoryNameTaken,
      Authorized<"admin">
    >;
    /** Moves every use of `category` to `into` and deletes it; returns `into`. */
    readonly mergeCategory: (
      category: CategorySlug,
      into: CategorySlug,
    ) => Effect.Effect<
      CategorySummary,
      CategoryNotFound | CategoryMergeIntoSelf,
      Authorized<"admin">
    >;
    /** Deletes a category no subblog or post (of any status) uses. */
    readonly deleteCategory: (
      category: CategorySlug,
    ) => Effect.Effect<
      void,
      CategoryNotFound | CategoryInUse,
      Authorized<"admin">
    >;
  }
>()("@unhalteproblem.de/backend/domains/blogs/CategoryCommands") {
  /** Needs `CategoryRepository`, `UserDirectory`, `AuditCommands` and `Transaction`. */
  static readonly layer = Layer.effect(CategoryCommands, make);
}
