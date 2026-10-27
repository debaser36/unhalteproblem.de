import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { BlogNotFound, BlogSlug } from "@unhalteproblem.de/api";
import { ApiClient } from "./ApiClient.ts";
import { AsyncView } from "./AsyncView.tsx";
import { decode } from "#testing/fixtures.ts";
import { fakeApi } from "#testing/FakeApi.ts";
import { renderWithApi } from "#testing/render.tsx";

const blogsAtom = ApiClient.query("blogs", "listBlogs", {});
const slug = decode(BlogSlug)("missing");
const blogAtom = ApiClient.query("blogs", "getBlog", {
  params: { blog: slug },
});

const notFound = () =>
  fakeApi({
    blogs: { getBlog: () => Effect.fail(new BlogNotFound({ blog: slug })) },
  });

describe("AsyncView", () => {
  it("shows the loading state, then the value", async () => {
    let resolve = () => {};
    const ready = new Promise<void>((r) => (resolve = r));
    const { screen } = await renderWithApi(
      <AsyncView atom={blogsAtom} loading={<p>loading…</p>}>
        {(blogs) => <p>{blogs.length} blogs</p>}
      </AsyncView>,
      fakeApi({
        blogs: {
          listBlogs: () => Effect.promise(() => ready).pipe(Effect.as([])),
        },
      }),
    );

    await expect.element(screen.getByText("loading…")).toBeVisible();
    resolve();
    await expect.element(screen.getByText("0 blogs")).toBeVisible();
  });

  it("explains a failure", async () => {
    const { screen } = await renderWithApi(
      <AsyncView atom={blogAtom}>{() => null}</AsyncView>,
      notFound(),
    );
    await expect
      .element(screen.getByRole("alert").getByText("Could not load this."))
      .toBeVisible();
  });

  it("lets the caller render its own failure", async () => {
    const custom = await renderWithApi(
      <AsyncView
        atom={blogAtom}
        failure={(tag) =>
          tag === "BlogNotFound" ? <p>no such blog</p> : undefined
        }
      >
        {() => null}
      </AsyncView>,
      notFound(),
    );
    await expect.element(custom.screen.getByText("no such blog")).toBeVisible();
  });
});
