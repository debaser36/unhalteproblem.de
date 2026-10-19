import { MediaId } from "#domain/Media";
import { MediaNotFound } from "#errors/MediaNotFound";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * The uploaded images, served to everyone.
 *
 * Public on purpose (no `Authentication`): the images are shown in
 * published posts to anonymous visitors, and `<img>` requests carry no
 * credentials the backend could check anyway. Ids are random UUIDs, so an
 * image of a draft is only found by whoever knows its URL.
 */
export class MediaGroup extends HttpApiGroup.make("media")
  .add(
    HttpApiEndpoint.get("getMedia", "/media/:mediaId", {
      params: { mediaId: MediaId },
      // Documents the body only: the handler returns the response itself,
      // with the stored image type as `Content-Type`.
      success: Schema.Uint8Array.pipe(
        HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" }),
      ).annotate({
        description:
          "The image bytes, with its stored type (`MediaContentType`) as " +
          "`Content-Type`.",
      }),
      error: MediaNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get an image",
        description:
          "Public. Returns the uploaded image with its stored type as " +
          "`Content-Type`, cacheable forever (`Cache-Control: public, " +
          "max-age=31536000, immutable`, images never change), with " +
          "`X-Content-Type-Options: nosniff`, `Content-Security-Policy: " +
          "default-src 'none'; sandbox` and `Content-Disposition: inline`. " +
          "The website links it as `/api/media/<id>` (`mediaUrl`). Answers " +
          "404 `MediaNotFound` for an unknown id.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Media",
      description: "Uploaded images, as embedded in posts.",
    }),
  ) {}
