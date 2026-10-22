import { useAtomValue } from "@effect/atom-react";
import { CategoryLimits, categorySlugOf } from "@unhalteproblem.de/api";
import { AsyncResult } from "effect/reactivity";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { cleanCategoryName } from "#lib/categories.ts";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Field, Input } from "#ui/Field.tsx";
import { categoriesAtom } from "./blogAtoms.ts";

/** What an editor has chosen so far; checked with `categoriesInput`. */
export interface CategoryChoice {
  readonly main: string;
  readonly extra: ReadonlyArray<string>;
}

/**
 * Choosing a main category and up to three more. Both inputs suggest the
 * existing categories; a name that matches none creates a new category
 * when saved, which everyone can then choose too.
 */
export function CategoryFields({
  value,
  onChange,
  error,
}: {
  readonly value: CategoryChoice;
  readonly onChange: (next: CategoryChoice) => void;
  readonly error?: string | undefined;
}) {
  const listId = useId();
  const categories = useAtomValue(categoriesAtom);
  const [draft, setDraft] = useState("");
  const known = AsyncResult.isSuccess(categories) ? categories.value : [];
  const isNew = (name: string) => {
    const slug = categorySlugOf(name);
    return slug !== "" && !known.some((category) => category.slug === slug);
  };
  const full = value.extra.length >= CategoryLimits.maxExtra;

  const add = () => {
    const name = cleanCategoryName(draft);
    if (name === "" || full) return;
    const slug = categorySlugOf(name);
    const taken = [value.main, ...value.extra].some(
      (other) => categorySlugOf(other) === slug,
    );
    if (!taken) onChange({ ...value, extra: [...value.extra, name] });
    setDraft("");
  };

  return (
    <>
      <datalist id={listId}>
        {known.map((category) => (
          <option key={category.slug} value={category.name} />
        ))}
      </datalist>
      <Field
        label="Main category"
        hint={
          isNew(value.main)
            ? "New category: it will be added for everyone."
            : "Pick one, or type a new one."
        }
        error={error}
      >
        {(control) => (
          <Input
            {...control}
            list={listId}
            value={value.main}
            maxLength={CategoryLimits.nameMaxLength}
            placeholder="Programming"
            onChange={(e) => onChange({ ...value, main: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="More categories"
        hint={`Optional, at most ${CategoryLimits.maxExtra}.`}
      >
        {(control) => (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                {...control}
                list={listId}
                value={draft}
                disabled={full}
                maxLength={CategoryLimits.nameMaxLength}
                placeholder={full ? "That's the maximum" : "Security"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    add();
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                aria-label="Add category"
                icon={<Plus size={15} />}
                disabled={full || cleanCategoryName(draft) === ""}
                onClick={add}
              />
            </div>
            {value.extra.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {value.extra.map((name) => (
                  <li key={name}>
                    <Badge tone={isNew(name) ? "warning" : "neutral"}>
                      {name}
                      {isNew(name) && <span className="sr-only">(new)</span>}
                      <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        className="-mr-1 rounded hover:text-fg"
                        onClick={() =>
                          onChange({
                            ...value,
                            extra: value.extra.filter(
                              (other) => other !== name,
                            ),
                          })
                        }
                      >
                        <X size={13} />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Field>
    </>
  );
}
