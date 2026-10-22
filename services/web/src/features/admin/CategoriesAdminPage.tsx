import { useAtomSet } from "@effect/atom-react";
import {
  type Category,
  CategoryLimits,
  categorySlugOf,
  PresetCategories,
} from "@unhalteproblem.de/api";
import { Exit } from "effect";
import { Check, GitMerge, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiClient } from "#api/ApiClient.ts";
import { AsyncView } from "#api/AsyncView.tsx";
import { failureMessage } from "#api/errors.ts";
import {
  blogsKey,
  categoriesAtom,
  categoriesKey,
  feedKey,
} from "#features/blog/blogAtoms.ts";
import { cleanCategoryName } from "#lib/categories.ts";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Input, Select } from "#ui/Field.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import { useToast } from "#ui/toasts.ts";
import { AdminHeading } from "./AdminHeading.tsx";

const renameCategory = ApiClient.mutation("admin", "renameCategory");
const mergeCategory = ApiClient.mutation("admin", "mergeCategory");
const deleteCategory = ApiClient.mutation("admin", "deleteCategory");

// Everything that shows categories: the blogs, the feeds and the list.
// Single-blog keys are left alone; their pages refetch after 5 minutes.
const changedKeys = [categoriesKey, blogsKey, feedKey];

const presetSlugs = new Set<string>(PresetCategories.map(categorySlugOf));

const messages = {
  CategoryNotFound: "This category doesn't exist any more.",
  CategoryNameTaken:
    "Another category already has this name. Merge them instead.",
  CategoryMergeIntoSelf: "A category can't be merged into itself.",
  CategoryInUse:
    "Still used by a blog or post (drafts included). Merge it into another one instead.",
};

export function CategoriesAdminPage() {
  return (
    <>
      <AdminHeading title="Categories">
        Every subblog and post has a main category and up to three more. Editors
        add new ones simply by using a new name; tidy them up here. Counts are
        subblogs and published posts.
      </AdminHeading>
      <AsyncView atom={categoriesAtom}>
        {(categories) =>
          categories.length === 0 ? (
            <EmptyState title="No categories." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Blogs</Th>
                  <Th>Posts</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <CategoryRow
                    key={category.slug}
                    category={category}
                    others={categories.filter(
                      (other) => other.slug !== category.slug,
                    )}
                  />
                ))}
              </tbody>
            </Table>
          )
        }
      </AsyncView>
    </>
  );
}

function CategoryRow({
  category,
  others,
}: {
  readonly category: Category;
  readonly others: ReadonlyArray<Category>;
}) {
  const rename = useAtomSet(renameCategory, { mode: "promiseExit" });
  const merge = useAtomSet(mergeCategory, { mode: "promiseExit" });
  const remove = useAtomSet(deleteCategory, { mode: "promiseExit" });
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [dialog, setDialog] = useState<"merge" | "delete">();
  const [into, setInto] = useState("");
  const [pending, setPending] = useState(false);

  const report = (exit: Exit.Exit<unknown, unknown>, success: string) => {
    const error = failureMessage(exit, messages);
    toast(error === undefined ? "success" : "error", error ?? success);
    return Exit.isSuccess(exit);
  };

  const onRename = async (event: FormEvent) => {
    event.preventDefault();
    const next = cleanCategoryName(name);
    if (next === "" || categorySlugOf(next) === "") return;
    setPending(true);
    const exit = await rename({
      params: { category: category.slug },
      payload: { name: next },
      reactivityKeys: changedKeys,
    });
    setPending(false);
    if (report(exit, `Renamed to ${next}.`)) setEditing(false);
  };

  const onMerge = async () => {
    const target = others.find((other) => other.slug === into);
    if (target === undefined) return;
    setPending(true);
    const exit = await merge({
      params: { category: category.slug },
      payload: { into: target.slug },
      reactivityKeys: changedKeys,
    });
    setPending(false);
    if (report(exit, `Merged into ${target.name}.`)) setDialog(undefined);
  };

  const onDelete = async () => {
    setPending(true);
    const exit = await remove({
      params: { category: category.slug },
      reactivityKeys: changedKeys,
    });
    setPending(false);
    if (report(exit, `Deleted ${category.name}.`)) setDialog(undefined);
  };

  return (
    <tr className="hover:bg-surface-2/50">
      <Td>
        {editing ? (
          <form onSubmit={onRename} className="flex gap-2">
            <Input
              aria-label="New name"
              required
              autoFocus
              maxLength={CategoryLimits.nameMaxLength}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={pending}
              icon={<Check size={14} />}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setName(category.name);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <p className="font-medium text-fg">
              {category.name}
              {presetSlugs.has(category.slug) && (
                <Badge className="ml-2">preset</Badge>
              )}
            </p>
            <p className="font-mono text-xs text-muted">{category.slug}</p>
          </>
        )}
      </Td>
      <Td>{category.blogCount}</Td>
      <Td>{category.postCount}</Td>
      <Td className="text-right whitespace-nowrap">
        <Button
          size="sm"
          variant="ghost"
          icon={<Pencil size={14} />}
          onClick={() => setEditing(true)}
        >
          Rename
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<GitMerge size={14} />}
          disabled={others.length === 0}
          onClick={() => setDialog("merge")}
        >
          Merge
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={14} />}
          onClick={() => setDialog("delete")}
        >
          Delete
        </Button>
        <Dialog
          open={dialog === "merge"}
          onClose={() => setDialog(undefined)}
          title={`Merge ${category.name} into…`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(undefined)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={pending}
                disabled={into === ""}
                onClick={onMerge}
              >
                Merge
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-fg-soft">
            Every blog and post in {category.name} moves to the category you
            pick, and {category.name} is deleted.
          </p>
          <Select
            aria-label="Target category"
            value={into}
            onChange={(e) => setInto(e.target.value)}
          >
            <option value="">Choose a category</option>
            {others.map((other) => (
              <option key={other.slug} value={other.slug}>
                {other.name}
              </option>
            ))}
          </Select>
        </Dialog>
        <Dialog
          open={dialog === "delete"}
          onClose={() => setDialog(undefined)}
          title={`Delete ${category.name}?`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(undefined)}>
                Cancel
              </Button>
              <Button variant="danger" loading={pending} onClick={onDelete}>
                Delete
              </Button>
            </>
          }
        >
          Only unused categories can be deleted. Merge a used one instead.
        </Dialog>
      </Td>
    </tr>
  );
}
