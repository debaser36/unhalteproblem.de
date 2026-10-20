/** What to tell an editor when an image upload fails, by error tag. */
export const uploadMessages: Record<string, string> = {
  UnsupportedMedia:
    "Only PNG, JPEG, WebP, GIF and AVIF images can be uploaded.",
  MediaTooLarge: "Images can be at most 5 MiB.",
  InvalidUpload: "The upload was not understood. Try again.",
};
