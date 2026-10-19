import { Api } from "@unhalteproblem.de/api";
import { FetchHttpClient } from "effect/http";
import { AtomHttpApi } from "effect/reactivity";

/**
 * The typed client of the backend, generated from the shared contract.
 *
 * `ApiClient.query(group, endpoint, request)` gives an atom of the response
 * (cached per request, refreshed when a mutation names one of its
 * `reactivityKeys`), `ApiClient.mutation(group, endpoint)` an atom function
 * for writes. Requests go to `/api` on the site's own origin (nginx in
 * production, the Vite proxy in development), so the session cookie is
 * sent along without any configuration.
 */
export class ApiClient extends AtomHttpApi.Service<ApiClient>()(
  "@unhalteproblem.de/website/ApiClient",
  {
    api: Api,
    httpClient: FetchHttpClient.layer,
    baseUrl: new URL("/api", window.location.origin).href,
  },
) {}
