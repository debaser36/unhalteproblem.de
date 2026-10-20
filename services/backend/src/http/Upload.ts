import { InvalidUpload, MediaTooLarge } from "@unhalteproblem.de/api";
import { Array as Arr, Effect, Option, Stream } from "effect";
import { Multipart } from "effect/http";

/**
 * Too much was sent (413), or not a single well-formed file part (400): a
 * second part trips `maxParts`, which is a malformed upload, not a big one.
 */
const uploadError = (error: Multipart.MultipartError) =>
  error.reason._tag === "FileTooLarge" || error.reason._tag === "BodyTooLarge"
    ? new MediaTooLarge()
    : new InvalidUpload();

/**
 * The bytes of an upload's file part `file` (the contract's `MediaUpload`),
 * read only when the effect runs: run it after the authorization check.
 */
export const uploadedFile = (
  parts: Stream.Stream<Multipart.Part, Multipart.MultipartError>,
) =>
  Effect.gen(function* () {
    const files = yield* parts.pipe(
      Stream.filter(Multipart.isFile),
      Stream.filter((file) => file.key === "file"),
      // Read the content while the parts are still being parsed: it is
      // pulled from the request body, which is closed once the stream ends,
      // so reading it afterwards waits forever for a file of more than one
      // chunk.
      Stream.mapEffect((file) => file.contentEffect),
      // Drain the stream instead of stopping at the first file: a file over
      // the limit ends its content early, cut off, and the parser's
      // `FileTooLarge` (or `BodyTooLarge`, `TooManyParts`) only fails the
      // next pull of the parts.
      Stream.runCollect,
    );
    const bytes = Arr.head(files);
    if (Option.isNone(bytes)) return yield* new InvalidUpload();
    return bytes.value;
  }).pipe(
    Effect.catchTag("MultipartError", (error) => Effect.fail(uploadError(error))),
  );
