import { ContactMessageId } from "#domain/ContactMessage";
import { Schema } from "effect";

/**
 * No contact message has the requested id (404): it never existed, was
 * deleted, or was purged by the retention job.
 */
export class ContactMessageNotFound extends Schema.TaggedError<
  ContactMessageNotFound,
  { readonly brand: unique symbol }
>()(
  "ContactMessageNotFound",
  { messageId: ContactMessageId },
  {
    httpApiStatus: 404,
    description: "No contact message with this id exists.",
  },
) {}
