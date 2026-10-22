import { Context, Effect, Layer } from "effect";
import * as Query from "#cqrs/Query";
import {
  CategoryRepository,
  type CategorySummary,
} from "./CategoryRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* CategoryRepository;
  return CategoryQueries.of({
    listCategories: repository.list.pipe(
      Query.boundary,
      Effect.withSpan("CategoryQueries.listCategories"),
    ),
  });
});

/** The reads of categories: the shared list, public like the blogs. */
export class CategoryQueries extends Context.Service<
  CategoryQueries,
  {
    /** Every category by name, with its subblogs and published posts counted. */
    readonly listCategories: Effect.Effect<ReadonlyArray<CategorySummary>>;
  }
>()("@unhalteproblem.de/backend/domains/blogs/CategoryQueries") {
  /** Needs `CategoryRepository`. */
  static readonly layer = Layer.effect(CategoryQueries, make);
}
