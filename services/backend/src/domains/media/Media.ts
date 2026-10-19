import {
  type BlogSlug,
  MediaContentType,
  MediaId,
  MediaLimits,
} from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { Model } from "effect/schema";
import { UserId } from "#domains/users/User";

/**
 * Uploaded images, stored in Postgres (`media`) and served at
 * `/media/:mediaId`. Each belongs to a scope, the part of the site it was
 * uploaded for: `blog:<slug>` for a subblog's posts, `projects` for the
 * project pages. Who may upload into a scope is decided by the command that
 * calls `MediaCommands.store`; the media domain checks only the file.
 */

export { MediaContentType, MediaId, MediaLimits };

const SCOPE_PATTERN = /^(?:blog:[a-z0-9]+(?:-[a-z0-9]+)*|projects)$/u;

/** Where an image was uploaded for: `blog:<slug>` or `projects`. */
export const MediaScope = Schema.String.check(
  Schema.isPattern(SCOPE_PATTERN),
  Schema.isMaxLength(69),
).pipe(Schema.brand("MediaScope"));
export type MediaScope = typeof MediaScope.Type;

/** The scope of the images of a subblog's posts. */
export const blogScope = (blog: BlogSlug): MediaScope =>
  MediaScope.make(`blog:${blog}`);

/** The scope of the images of the project pages. */
export const projectsScope: MediaScope = MediaScope.make("projects");

/** An uploaded image, with its bytes. */
export class StoredMedia extends Model.Class<StoredMedia>("StoredMedia")({
  id: MediaId,
  contentType: MediaContentType,
  data: Schema.Uint8Array,
  byteSize: Schema.Int,
  /** SHA-256 of `data`; the database checks it. */
  sha256: Schema.Uint8Array,
  scope: MediaScope,
  uploadedBy: Schema.OptionFromNullOr(UserId),
  uploadedAt: Schema.DateTimeUtcFromDate,
}) {}

// Errors: the contract's, so they map to their status codes as they are.
export {
  MediaNotFound,
  MediaTooLarge,
  UnsupportedMedia,
} from "@unhalteproblem.de/api";

// Rules

const startsWith = (
  bytes: Uint8Array,
  signature: ReadonlyArray<number>,
  offset = 0,
) =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * The image type of `bytes`, detected from their magic numbers, never from
 * what the client claimed. Only raster formats browsers display without
 * running anything: SVG (which can carry script) is deliberately not one of
 * them.
 */
export const detectContentType = (
  bytes: Uint8Array,
): Option.Option<MediaContentType> => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return Option.some("image/png");
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return Option.some("image/jpeg");
  if (
    startsWith(bytes, ascii("GIF87a")) ||
    startsWith(bytes, ascii("GIF89a"))
  ) {
    return Option.some("image/gif");
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return Option.some("image/webp");
  }
  // ISO BMFF: a box size, then "ftyp" and the major brand.
  if (
    startsWith(bytes, ascii("ftyp"), 4) &&
    (startsWith(bytes, ascii("avif"), 8) || startsWith(bytes, ascii("avis"), 8))
  ) {
    return Option.some("image/avif");
  }
  return Option.none();
};

export const isTooLarge = (bytes: Uint8Array) =>
  bytes.length === 0 || bytes.length > MediaLimits.maxBytes;
