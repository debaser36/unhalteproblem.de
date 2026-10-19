import { HttpApiMiddleware } from "effect/http-api";

// Definition only. The implementation lives in the backend; the browser
// needs none.

/**
 * Raises the request body limit for endpoints that take large JSON
 * payloads, such as a post with its whole document (`createPost`,
 * `updatePost`). The backend implementation provides a larger
 * `HttpIncomingMessage.MaxBodySize` (512 KiB) to the endpoint, which reads
 * and decodes the body inside the middleware.
 *
 * Put it on the endpoint, before `SameOrigin` (so the origin is checked
 * first). It fails with nothing of its own, needs nothing from other
 * middlewares, provides nothing, and declares no security scheme.
 */
export class LargeBody extends HttpApiMiddleware.Service<LargeBody>()(
  "@unhalteproblem.de/api/LargeBody",
) {}
