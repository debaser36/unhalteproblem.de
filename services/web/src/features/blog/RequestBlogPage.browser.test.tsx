import { BlogRequest, BlogRequestAlreadyPending } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decode } from "#testing/fixtures.ts";
import { fakeApi } from "#testing/FakeApi.ts";
import { renderApp } from "#testing/render.tsx";

const pendingRequest = decode(BlogRequest)({
  id: "22222222-2222-4222-8222-222222222222",
  title: "Compilers",
  description: "Parsing, types, codegen.",
  status: "pending",
  createdAt: "2026-10-01T10:00:00.000Z",
  decidedAt: null,
  reason: null,
  blog: null,
});

describe("RequestBlogPage", () => {
  it("sends a request and shows it in the list", async () => {
    let requests: ReadonlyArray<BlogRequest> = [];
    const api = fakeApi(
      {
        blogRequests: {
          listMyBlogRequests: () => Effect.sync(() => requests),
          requestBlog: () =>
            Effect.sync(() => {
              requests = [pendingRequest];
              return pendingRequest;
            }),
        },
      },
      { roles: ["normalUser"] },
    );
    const { screen } = await renderApp("/blog/~request", api);

    const send = screen.getByRole("button", { name: "Send request" });
    await expect.element(send).toBeDisabled();
    await screen.getByLabelText("Title").fill("  Compilers ");
    await screen.getByLabelText("Description").fill("Parsing, types, codegen.");
    await send.click();

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Request sent. An admin will look at it.");
    expect(api.callsTo("blogRequests", "requestBlog")).toEqual([
      {
        payload: {
          title: "Compilers",
          description: "Parsing, types, codegen.",
        },
      },
    ]);
    // The mutation's reactivity key reloads the list; with a pending request
    // there is no form any more.
    await expect.element(screen.getByText("Compilers")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Withdraw" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Send request" }))
      .not.toBeInTheDocument();
  });

  it("explains a request that is already waiting", async () => {
    const api = fakeApi(
      {
        blogRequests: {
          listMyBlogRequests: () => Effect.succeed([]),
          requestBlog: () => Effect.fail(new BlogRequestAlreadyPending()),
        },
      },
      { roles: ["normalUser"] },
    );
    const { screen } = await renderApp("/blog/~request", api);

    await screen.getByLabelText("Title").fill("Compilers");
    await screen.getByRole("button", { name: "Send request" }).click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("You have a request waiting already.");
    await expect
      .element(screen.getByLabelText("Title"))
      .toHaveValue("Compilers");
  });

  it("withdraws a pending request", async () => {
    const api = fakeApi(
      {
        blogRequests: {
          listMyBlogRequests: () => Effect.succeed([pendingRequest]),
          withdrawBlogRequest: () =>
            Effect.succeed({ ...pendingRequest, status: "withdrawn" as const }),
        },
      },
      { roles: ["normalUser"] },
    );
    const { screen } = await renderApp("/blog/~request", api);

    await screen.getByRole("button", { name: "Withdraw" }).click();

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Request withdrawn.");
    expect(api.callsTo("blogRequests", "withdrawBlogRequest")).toEqual([
      { params: { requestId: pendingRequest.id } },
    ]);
  });
});
