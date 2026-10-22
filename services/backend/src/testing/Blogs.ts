import { assert } from "@effect/vitest";
import {
  blogEditorRole,
  type Document,
  type PostInput,
  type Role,
} from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { type AppOptions, login, makeAppWithServices, site } from "./App.ts";

/**
 * The backend's HTTP app with blog admins and editors, for end-to-end tests
 * of the blog, blog editor and media endpoints. Test support only, like
 * everything in `#testing/*`.
 */

export type Json = Record<string, unknown>;

export const json = (response: Response) =>
  Effect.promise(() => response.json() as Promise<Json>);

/** A document of one paragraph per text. */
export const doc = (...texts: ReadonlyArray<string>): Document => ({
  type: "doc",
  content: texts.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  })),
});

/** `count` words, for reading times. */
export const words = (count: number) =>
  Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

/** A post's fields, parts of which can be replaced. */
export const postInput = (
  slug: string,
  overrides: Partial<Record<keyof PostInput, unknown>> = {},
) => ({
  slug,
  title: `Title of ${slug}`,
  summary: `Summary of ${slug}`,
  tags: [],
  categories: { main: "Programming", extra: [] },
  coverImage: null,
  content: doc(words(10)),
  ...overrides,
});

/** The 8-byte PNG signature, followed by a few bytes. */
export const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** A multipart form with `bytes` as the file part `key`. */
export const form = (
  bytes: Uint8Array,
  options: { readonly key?: string; readonly type?: string } = {},
) => {
  const body = new FormData();
  body.append(
    options.key ?? "file",
    new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: options.type ?? "image/png",
    }),
    "upload.png",
  );
  return body;
};

/**
 * A multipart form as bytes and its content type. Sent as a buffer instead
 * of a `FormData` stream: when the server stops reading early (a limit, a
 * refusal), undici would keep pushing into the cancelled stream and fail
 * with an unhandled rejection.
 */
const encodeForm = (body: FormData) =>
  Effect.promise(async () => {
    const encoded = new Response(body);
    return {
      bytes: new Uint8Array(await encoded.arrayBuffer()),
      contentType: encoded.headers.get("content-type") ?? "",
    };
  });

/**
 * The app with logged-in users: `admin` (admin), `superAdmin` (superAdmin)
 * and `user` (normalUser only). Further users are added with `member`.
 */
export const makeBlogApp = Effect.fnUntraced(function* (
  options: AppOptions = {},
) {
  const app = yield* makeAppWithServices(options);
  const { request, sql } = app;

  /** Grants a role directly in SQL, as an operator would. */
  const grant = (subject: string, role: Role) =>
    sql(
      (sql) => sql`
        INSERT INTO user_roles (user_id, role)
        SELECT id, ${role} FROM users WHERE subject = ${subject}
      `,
    );

  /** Our id of the user with this subject. */
  const idOf = (subject: string) =>
    sql(
      (sql) => sql<{ readonly id: string }>`
        SELECT id FROM users WHERE subject = ${subject}
      `,
    ).pipe(Effect.map((rows) => rows[0]?.id ?? ""));

  /** Logs `subject` in and grants `roles` in SQL. */
  const member = (subject: string, ...roles: ReadonlyArray<Role>) =>
    Effect.gen(function* () {
      const cookie = yield* login(request, subject);
      for (const role of roles) yield* grant(subject, role);
      return { subject, cookie, id: yield* idOf(subject) };
    });

  /**
   * Sends a request with the session cookie (none if `cookie` is undefined)
   * and, unless `origin` is `null`, the site's `Origin`. A `body` that is a
   * `FormData` is sent as multipart, anything else as JSON.
   */
  const call = (
    cookie: string | undefined,
    method: string,
    path: string,
    options: {
      readonly body?: unknown;
      readonly origin?: string | null | undefined;
    } = {},
  ) =>
    Effect.gen(function* () {
      const body =
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? yield* encodeForm(options.body)
            : {
                bytes: JSON.stringify(options.body),
                contentType: "application/json",
              };
      return yield* request(path, {
        method,
        headers: {
          ...(cookie === undefined
            ? {}
            : { cookie: `__Host-session=${cookie}` }),
          ...(options.origin === null
            ? {}
            : { origin: options.origin ?? site }),
          ...(body === undefined ? {} : { "content-type": body.contentType }),
        },
        ...(body === undefined ? {} : { body: body.bytes }),
      });
    });

  /** Sends a request and checks its status; returns the JSON body. */
  const expect = (
    status: number,
    ...args: Parameters<typeof call>
  ): Effect.Effect<Json> =>
    Effect.gen(function* () {
      const response = yield* call(...args);
      const text = yield* Effect.promise(() => response.text());
      assert.strictEqual(
        response.status,
        status,
        `${args[1]} ${args[2]} answered ${response.status}: ${text}`,
      );
      return text === "" ? {} : (JSON.parse(text) as Json);
    });

  const admin = yield* member("admin", "admin");
  const superAdmin = yield* member("super", "superAdmin");
  const user = yield* member("user");

  /** Creates a subblog as `admin`; returns the `Blog`. */
  const createBlog = (slug: string, title = `Blog ${slug}`) =>
    expect(201, admin.cookie, "POST", "/admin/blogs", {
      body: {
        slug,
        title,
        description: `About ${slug}`,
        categories: { main: "Programming", extra: [] },
      },
    });

  /** Logs `subject` in as an editor of `blogs` (granted in SQL). */
  const editor = (subject: string, ...blogs: ReadonlyArray<string>) =>
    member(subject, ...blogs.map((blog) => blogEditorRole(blog)));

  /** Creates a draft as `cookie`; returns the `ManagedPost`. */
  const createPost = (
    cookie: string,
    blog: string,
    input: ReturnType<typeof postInput>,
  ) =>
    expect(201, cookie, "POST", `/blogs/${blog}/manage/posts`, {
      body: input,
    });

  /** Publishes a post as `cookie`; returns the `ManagedPost`. */
  const publish = (cookie: string, blog: string, id: unknown) =>
    expect(
      200,
      cookie,
      "POST",
      `/blogs/${blog}/manage/posts/${String(id)}/publish`,
    );

  /** Sets a post's first publication time in SQL, to order the feed. */
  const setPublishedAt = (id: unknown, at: Date) =>
    sql(
      (sql) => sql`
        UPDATE blog_posts SET published_at = ${at} WHERE id = ${String(id)}
      `,
    );

  return {
    ...app,
    admin,
    superAdmin,
    user,
    grant,
    idOf,
    member,
    call,
    expect,
    createBlog,
    editor,
    createPost,
    publish,
    setPublishedAt,
  };
});
