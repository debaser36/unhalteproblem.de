import { AccountGroup } from "#groups/Account";
import { AdminGroup } from "#groups/Admin";
import { AuthGroup } from "#groups/Auth";
import { BlogEditorGroup } from "#groups/BlogEditor";
import { BlogsGroup } from "#groups/Blogs";
import { ContactGroup } from "#groups/Contact";
import { MediaGroup } from "#groups/Media";
import { SystemGroup } from "#groups/System";
import { HttpApi, OpenApi } from "effect/http-api";

/**
 * The HTTP contract between the unhalteproblem.de backend services and the
 * website. Services implement it with `HttpApiBuilder`, the website calls it
 * through `HttpApiClient`.
 *
 * Group and endpoint names are the generated client's method names
 * (`client.health()`, `client.contact.submit(...)`), so renaming one is a
 * breaking change.
 */
export class Api extends HttpApi.make("unhalteproblem")
  .add(SystemGroup)
  .add(ContactGroup)
  .add(AuthGroup)
  .add(AdminGroup)
  .add(AccountGroup)
  .add(BlogsGroup)
  .add(MediaGroup)
  .add(BlogEditorGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "unhalteproblem.de API",
      description: "Backend API of the unhalteproblem.de website.",
    }),
  ) {}
