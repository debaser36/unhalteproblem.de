import { useAtomSet } from "@effect/atom-react";
import type { Blog, BlogSlug } from "@unhalteproblem.de/api";
import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { failureMessage } from "#api/errors.ts";
import { categoriesInput } from "#lib/categories.ts";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { useToast } from "#ui/toasts.ts";
import {
  blogKey,
  blogsKey,
  categoriesKey,
  feedKey,
  setBlogCategories,
} from "./blogAtoms.ts";
import { CategoryBadges } from "./CategoryBadges.tsx";
import { type CategoryChoice, CategoryFields } from "./CategoryFields.tsx";

/** The subblog's own categories, for its editors to change. */
export function BlogCategoriesCard({
  blog,
  info,
}: {
  readonly blog: BlogSlug;
  readonly info: Blog;
}) {
  const save = useAtomSet(setBlogCategories, { mode: "promiseExit" });
  const toast = useToast();
  const [choice, setChoice] = useState<CategoryChoice>();
  const [pending, setPending] = useState(false);
  const chosen =
    choice === undefined
      ? undefined
      : categoriesInput(choice.main, choice.extra);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (chosen === undefined || typeof chosen === "string") return;
    setPending(true);
    const exit = await save({
      params: { blog },
      payload: chosen,
      reactivityKeys: [blogKey(blog), blogsKey, feedKey, categoriesKey],
    });
    setPending(false);
    const error = failureMessage(exit);
    toast(error === undefined ? "success" : "error", error ?? "Saved.");
    if (error === undefined) setChoice(undefined);
  };

  return (
    <Card className="mb-8 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-fg">Blog categories</h2>
        {choice === undefined && (
          <div className="flex items-center gap-3">
            <CategoryBadges categories={info.categories} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setChoice({
                  main: info.categories.main.name,
                  extra: info.categories.extra.map(({ name }) => name),
                })
              }
            >
              Change
            </Button>
          </div>
        )}
      </div>
      {choice !== undefined && (
        <form onSubmit={onSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <CategoryFields
            value={choice}
            onChange={setChoice}
            error={typeof chosen === "string" ? chosen : undefined}
          />
          <div className="flex gap-2 sm:col-span-2">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={pending}
              disabled={typeof chosen === "string"}
              icon={<Check size={14} />}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setChoice(undefined)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
