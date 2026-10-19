import { MediaUrl } from "#domain/Document";
import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { Schema } from "effect";

/** The id of an uploaded image (a UUID). */
export const MediaId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("MediaId"))
  .annotate({
    identifier: "MediaId",
    description: "The id of an uploaded image (a UUID).",
  });
export type MediaId = typeof MediaId.Type;

/** Limits of an upload. */
export const MediaLimits = {
  /** Largest accepted image: 5 MiB. */
  maxBytes: 5 * 1024 * 1024,
} as const;

/**
 * The image types that can be uploaded. The backend detects the type from
 * the file's content (magic bytes), not from what the client claims.
 */
export const MediaContentType = Schema.Literals([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]).annotate({
  identifier: "MediaContentType",
  description:
    "Type of an uploaded image: PNG, JPEG, WebP, GIF or AVIF, detected " +
    "from the content.",
});
export type MediaContentType = typeof MediaContentType.Type;

/**
 * The website's URL of the image `id`, `/api/media/<id>`: the path through
 * the website's reverse proxy, which strips `/api` before it reaches the
 * backend's `GET /media/:mediaId`. Use it as the `src` of images in
 * documents.
 */
export const mediaUrl = (id: MediaId): MediaUrl => `/api/media/${id}`;

/** An uploaded image. Body of `uploadMedia`. */
export const MediaInfo = Schema.Struct({
  id: MediaId,
  /** Where the website serves it (`mediaUrl(id)`). */
  url: MediaUrl,
  contentType: MediaContentType,
  /** Size in bytes, 1 to 5 MiB. */
  byteSize: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MediaLimits.maxBytes }),
  ),
  uploadedAt: IsoDateTimeUtc,
}).annotate({
  identifier: "MediaInfo",
  description:
    "An uploaded image: its id, its URL on the website (`/api/media/<id>`), " +
    "type, size and upload time.",
});
export type MediaInfo = typeof MediaInfo.Type;
