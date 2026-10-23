import { AccountGroup } from "#groups/Account";
import { AdminGroup } from "#groups/Admin";
import { AdminInsightsGroup } from "#groups/AdminInsights";
import { AuthGroup } from "#groups/Auth";
import { BlogEditorGroup } from "#groups/BlogEditor";
import { BlogRequestAdminGroup } from "#groups/BlogRequestAdmin";
import { BlogRequestsGroup } from "#groups/BlogRequests";
import { BlogsGroup } from "#groups/Blogs";
import { ContactGroup } from "#groups/Contact";
import { FoodPlannerGroup } from "#groups/Food";
import { MediaGroup } from "#groups/Media";
import { PaymentAdminGroup } from "#groups/PaymentAdmin";
import {
  PaymentCatalogGroup,
  PaymentsGroup,
  PaymentWebhooksGroup,
} from "#groups/Payments";
import { ProjectAdminGroup } from "#groups/ProjectAdmin";
import { ProjectsGroup } from "#groups/Projects";
import { SeoGroup } from "#groups/Seo";
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
  .add(ProjectsGroup)
  .add(ProjectAdminGroup)
  .add(AdminInsightsGroup)
  .add(BlogRequestsGroup)
  .add(BlogRequestAdminGroup)
  .add(SeoGroup)
  .add(FoodPlannerGroup)
  .add(PaymentCatalogGroup)
  .add(PaymentsGroup)
  .add(PaymentWebhooksGroup)
  .add(PaymentAdminGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "unhalteproblem.de API",
      description: "Backend API of the unhalteproblem.de website.",
    }),
  ) {}
