import {
  ManagedProject,
  type ProjectInput,
  ProjectSlugTaken,
} from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { decode } from "#testing/fixtures.ts";
import { fakeApi } from "#testing/FakeApi.ts";
import { renderWithApi } from "#testing/render.tsx";
import { ProjectEditor } from "./ProjectEditor.tsx";

const existing = decode(ManagedProject)({
  id: "44444444-4444-4444-8444-444444444444",
  slug: "website",
  title: "Website",
  summary: "This site.",
  tags: ["react"],
  status: "active",
  featured: false,
  repoUrl: null,
  liveUrl: null,
  coverImage: null,
  updatedAt: "2026-10-01T10:00:00.000Z",
  published: true,
  position: 0,
  createdAt: "2026-10-01T10:00:00.000Z",
  version: 2,
  content: { type: "doc", content: [{ type: "paragraph" }] },
});

const savedAs = (
  input: ProjectInput,
  version: ManagedProject["version"],
): ManagedProject => ({ ...existing, ...input, version });

const renderEditor = (
  project: ManagedProject | null,
  api: ReturnType<typeof fakeApi>,
) => {
  const props = {
    onSaved: vi.fn<(project: ManagedProject) => void>(),
    onClose: vi.fn<() => void>(),
    onDeleted: vi.fn<() => void>(),
  };
  return renderWithApi(
    <ProjectEditor project={project} {...props} />,
    api,
  ).then((rendered) => ({ ...rendered, props }));
};

describe("ProjectEditor", () => {
  it("publishes a new project with its settings", async () => {
    const api = fakeApi({
      projectAdmin: {
        createProject: ({ payload }) =>
          Effect.succeed(savedAs(payload, existing.version)),
      },
    });
    const { screen, props } = await renderEditor(null, api);

    await screen.getByLabelText("Title").fill("Type checker");
    await screen.getByLabelText("Summary").fill("A small one.");
    await screen.getByLabelText("Tags").fill("rust, compilers");
    await screen.getByLabelText("Source code").fill("https://github.com/x/tc");
    await screen.getByLabelText("Status").selectOptions("completed");
    await screen.getByLabelText("Position").fill("7");
    await screen.getByLabelText(/Featured/).click();
    await screen.getByRole("button", { name: "Publish" }).click();

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Saved.");
    expect(api.callsTo("projectAdmin", "createProject")).toMatchObject([
      {
        payload: {
          slug: "type-checker",
          title: "Type checker",
          summary: "A small one.",
          tags: ["rust", "compilers"],
          status: "completed",
          featured: true,
          position: 7,
          repoUrl: "https://github.com/x/tc",
          liveUrl: null,
          published: true,
        },
      },
    ]);
    expect(props.onSaved).toHaveBeenCalledOnce();
  });

  it("rejects links and positions the backend would refuse", async () => {
    const api = fakeApi({});
    const { screen } = await renderEditor(null, api);

    await screen.getByLabelText("Title").fill("Type checker");
    await screen.getByLabelText("Live version").fill("ftp://example.org");
    await screen.getByRole("button", { name: "Save" }).click();
    await expect
      .element(screen.getByText(/Links must be full http\(s\) URLs/))
      .toBeVisible();

    await screen.getByLabelText("Live version").fill("");
    await screen.getByLabelText("Position").fill("1.5");
    await screen.getByRole("button", { name: "Save" }).click();
    await expect
      .element(screen.getByText(/The position must be a whole number/))
      .toBeVisible();

    expect(api.calls).toEqual([]);
  });

  it("explains a slug that is taken", async () => {
    const api = fakeApi({
      projectAdmin: {
        updateProject: ({ payload }) =>
          Effect.fail(new ProjectSlugTaken({ slug: payload.slug })),
      },
    });
    const { screen } = await renderEditor(existing, api);

    await screen.getByLabelText("Title").fill("Website, again");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByText("Another project already uses this URL slug."))
      .toBeVisible();
    expect(api.callsTo("projectAdmin", "updateProject")).toMatchObject([
      { params: { projectId: existing.id }, payload: { version: 2 } },
    ]);
  });

  it("hides a published project by saving it unpublished", async () => {
    const api = fakeApi({
      projectAdmin: {
        updateProject: ({ payload }) =>
          Effect.succeed(savedAs(payload, existing.version)),
      },
    });
    const { screen } = await renderEditor(existing, api);

    await screen.getByRole("button", { name: "Hide" }).click();

    await expect
      .element(screen.getByRole("button", { name: "Publish" }))
      .toBeVisible();
    expect(api.callsTo("projectAdmin", "updateProject")).toMatchObject([
      { payload: { published: false } },
    ]);
  });
});
