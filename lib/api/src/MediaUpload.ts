/**
 * The pieces of an image upload endpoint, shared by every group that takes
 * uploads (`blogEditor.uploadMedia`, `projectAdmin.uploadProjectMedia`), so
 * they accept, answer and fail alike.
 */
import { MediaInfo, MediaLimits } from "#domain/Media";
import { InvalidUpload } from "#errors/InvalidUpload";
import { MediaTooLarge } from "#errors/MediaTooLarge";
import { UnsupportedMedia } from "#errors/UnsupportedMedia";
import { Schema } from "effect";
import { Multipart } from "effect/http";
import { HttpApiSchema } from "effect/http-api";

/**
 * Payload of an upload: a multipart form with one file part `file`,
 * streamed to the handler. The limits stop the parser before more than one
 * part or more than 5 MiB of file are read; 16 KiB on top cover the part
 * headers and boundaries.
 */
export const MediaUpload = Schema.Struct({
  file: Multipart.SingleFileSchema,
}).pipe(
  HttpApiSchema.asMultipartStream({
    maxParts: 1,
    maxFileSize: MediaLimits.maxBytes,
    maxTotalSize: MediaLimits.maxBytes + 16 * 1024,
  }),
);

/**
 * Success of an upload: the new `MediaInfo`, with status 201. A one-member
 * union, so the OpenAPI document keeps one `MediaInfo` component (see
 * `CreatedRestriction` in the admin group).
 */
export const CreatedMedia = Schema.Union([MediaInfo])
  .pipe(HttpApiSchema.status(201))
  .annotate({ description: "The uploaded image." });

/** The errors of the upload itself (415, 413, 400). */
export const MediaUploadErrors = [
  UnsupportedMedia,
  MediaTooLarge,
  InvalidUpload,
] as const;

/** Describes the upload, for the endpoint descriptions. */
export const mediaUploadDescription =
  "Takes a multipart form with exactly one file part named `file`, at most " +
  "5 MiB, and answers 201 with the stored image; use its `url` as the `src` " +
  "of images and its `id` as a `coverImage`. The type is detected from the " +
  "content: anything but PNG, JPEG, WebP, GIF or AVIF answers 415 " +
  "`UnsupportedMedia`. Answers 413 `MediaTooLarge` above 5 MiB and 400 " +
  "`InvalidUpload` for a body without exactly one `file` part.";
