import { OutboxMessageId } from "#domain/Outbox";
import { Schema } from "effect";

/**
 * No outbox message has the requested id (404). A handled message is
 * deleted, so it may have been handled in the meantime.
 */
export class OutboxMessageNotFound extends Schema.TaggedError<
  OutboxMessageNotFound,
  { readonly brand: unique symbol }
>()(
  "OutboxMessageNotFound",
  { messageId: OutboxMessageId },
  {
    httpApiStatus: 404,
    description:
      "No outbox message with this id exists (it may have been handled).",
  },
) {}
