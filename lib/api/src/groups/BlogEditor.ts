import { Authentication } from "#Authentication";
import { RequireBlogEditor } from "#Authorization";
import {
  Blog,
  BlogSlug,
  ManagedPost,
  ManagedPostListItem,
  PostId,
  PostInput,
  UpdatePostPayload,
} from "#domain/Blog";
import { CategoriesInput } from "#domain/Category";
import { BlogNotFound } from "#errors/BlogNotFound";
import { Forbidden } from "#errors/Forbidden";
import { PostEditConflict } from "#errors/PostEditConflict";
import { PostNotFound } from "#errors/PostNotFound";
import { PostSlugTaken } from "#errors/PostSlugTaken";
import { LargeBody } from "#LargeBody";
import {
  CreatedMedia,
  MediaUpload,
  MediaUploadErrors,
  mediaUploadDescription,
} from "#MediaUpload";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/** Path parameters of the endpoints for a subblog's posts. */
const BlogParams = { blog: BlogSlug };

/** Path parameters of the endpoints for one post. */
const PostParams = { blog: BlogSlug, postId: PostId };

/**
 * Success of `createPost`: the new `ManagedPost`, with status 201. A
 * one-member union, so the OpenAPI document keeps one `ManagedPost`
 * component (see `CreatedRestriction` in the admin group).
 */
const CreatedPost = Schema.Union([ManagedPost])
  .pipe(HttpApiSchema.status(201))
  .annotate({ description: "The new post, a draft." });

// Shared by every endpoint description.
const editorRule =
  "Requires `blogEditor:<blog>` for the subblog in the path (403 " +
  "`Forbidden` otherwise).";

/**
 * Editing the posts of a subblog, in place on the website. Every endpoint
 * requires a session (`Authentication`, 401) and the editor role of the
 * subblog in the path, `blogEditor:<blog>` (`RequireBlogEditor`, 403
 * `Forbidden`). The state-changing endpoints also require `SameOrigin`
 * (403 `Forbidden`), and those taking a whole post `LargeBody` (a larger
 * body limit). `RequireBlogEditor` provides no proof; the handlers still
 * provide `Authorized(blogEditorRole(blog))` themselves.
 *
 * Posts are addressed by id here, because editors may change the slug.
 *
 * Middleware order: the middleware added later is the outer one and runs
 * first, and `HttpApi` decodes the path parameters and the payload inside
 * all of them. The group adds `RequireBlogEditor` and then `Authentication`
 * after the endpoints; on an endpoint, `SameOrigin` is added after
 * `LargeBody`. The runtime order is therefore Authentication (401) →
 * RequireBlogEditor (403) → SameOrigin (403) → LargeBody → payload →
 * handler: only an editor of the subblog, from the website's origin, gets
 * the server to read a body, and only then a large one.
 */
export class BlogEditorGroup extends HttpApiGroup.make("blogEditor")
  .add(
    HttpApiEndpoint.get("listManagedPosts", "/blogs/:blog/manage/posts", {
      params: BlogParams,
      success: Schema.Array(ManagedPostListItem).annotate({
        description:
          "Every post of the subblog, drafts included, most recently " +
          "updated first.",
      }),
      error: Forbidden,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List a subblog's posts for editing",
        description:
          editorRule +
          " Returns every post of the subblog, drafts and published, " +
          "without content, most recently updated first.",
      }),
    ),
    HttpApiEndpoint.get("getManagedPost", "/blogs/:blog/manage/posts/:postId", {
      params: PostParams,
      success: ManagedPost,
      error: [Forbidden, PostNotFound],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a post for editing",
        description:
          editorRule +
          " Returns the post, draft or published, with its content and " +
          "`version`. Answers 404 `PostNotFound` for an id that is not a " +
          "post of this subblog.",
      }),
    ),
    HttpApiEndpoint.post("createPost", "/blogs/:blog/manage/posts", {
      params: BlogParams,
      payload: PostInput,
      success: CreatedPost,
      error: [Forbidden, BlogNotFound, PostSlugTaken],
    })
      .middleware(LargeBody)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Create a post",
          description:
            editorRule +
            " Requires a same-origin request. Creates a draft (version 1) " +
            "authored by the caller and answers 201 with it. Category names " +
            "that match no category create new ones. Answers 409 " +
            "`PostSlugTaken` if another post of the subblog has the slug, " +
            "and 404 `BlogNotFound` if the subblog does not exist.",
        }),
      ),
    HttpApiEndpoint.put("updatePost", "/blogs/:blog/manage/posts/:postId", {
      params: PostParams,
      payload: UpdatePostPayload,
      success: ManagedPost,
      error: [Forbidden, PostNotFound, PostSlugTaken, PostEditConflict],
    })
      .middleware(LargeBody)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Update a post",
          description:
            editorRule +
            " Requires a same-origin request. Replaces the post's editable " +
            "fields, keeps its status, increments `version` and answers " +
            "with the saved post. Category names that match no category " +
            "create new ones. Optimistic locking: `version` must be " +
            "the post's current version (the one the edit started from); " +
            "otherwise nothing is saved and it answers 409 " +
            "`PostEditConflict` with the current version. Answers 409 " +
            "`PostSlugTaken` if another post of the subblog has the slug " +
            "and 404 `PostNotFound` for an unknown id.",
        }),
      ),
    HttpApiEndpoint.post(
      "publishPost",
      "/blogs/:blog/manage/posts/:postId/publish",
      {
        params: PostParams,
        success: ManagedPost,
        error: [Forbidden, PostNotFound],
      },
    )
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Publish a post",
          description:
            editorRule +
            " Requires a same-origin request. Makes the post visible to " +
            "everyone. The first publication sets `publishedAt`; " +
            "republishing keeps it. Idempotent for a published post. " +
            "Answers 404 `PostNotFound` for an unknown id.",
        }),
      ),
    HttpApiEndpoint.post(
      "unpublishPost",
      "/blogs/:blog/manage/posts/:postId/unpublish",
      {
        params: PostParams,
        success: ManagedPost,
        error: [Forbidden, PostNotFound],
      },
    )
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Unpublish a post",
          description:
            editorRule +
            " Requires a same-origin request. Turns the post back into a " +
            "draft, visible to editors only. `publishedAt` stays as the " +
            "time of the first publication. Idempotent for a draft. " +
            "Answers 404 `PostNotFound` for an unknown id.",
        }),
      ),
    HttpApiEndpoint.delete("deletePost", "/blogs/:blog/manage/posts/:postId", {
      params: PostParams,
      success: HttpApiSchema.NoContent.annotate({
        description: "The post is deleted.",
      }),
      error: [Forbidden, PostNotFound],
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Delete a post",
          description:
            editorRule +
            " Requires a same-origin request. Deletes the post, draft or " +
            "published, irreversibly. Its images stay. Answers 404 " +
            "`PostNotFound` for an unknown id.",
        }),
      ),
    HttpApiEndpoint.put("setBlogCategories", "/blogs/:blog/manage/categories", {
      params: BlogParams,
      payload: CategoriesInput,
      success: Blog,
      error: [Forbidden, BlogNotFound],
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Set the categories of a subblog",
          description:
            editorRule +
            " Requires a same-origin request. Replaces the subblog's main " +
            "and extra categories and answers with the subblog. Categories " +
            "are given by name and matched by their derived slug; a name " +
            "that matches no category creates a new one, visible to " +
            "everyone at once. Answers 404 `BlogNotFound` if the subblog " +
            "does not exist.",
        }),
      ),
    HttpApiEndpoint.post("uploadMedia", "/blogs/:blog/manage/media", {
      params: BlogParams,
      payload: MediaUpload,
      success: CreatedMedia,
      error: [Forbidden, ...MediaUploadErrors],
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Upload an image",
          description:
            editorRule +
            " Requires a same-origin request. " +
            mediaUploadDescription,
        }),
      ),
  )
  // Both protect every endpoint above and are added after them, so they
  // run before the endpoints' own `SameOrigin` and `LargeBody` and before
  // the payload is read. `Authentication` comes last: it runs first,
  // answers 401 before any 403, and provides the `CurrentUser` that
  // `RequireBlogEditor` needs.
  .middleware(RequireBlogEditor)
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Blog editor",
      description:
        "Editing the posts of a subblog and uploading images, for holders " +
        "of the subblog's `blogEditor:<slug>` role.",
    }),
  ) {}
