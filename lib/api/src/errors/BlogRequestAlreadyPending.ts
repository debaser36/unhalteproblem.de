import { Schema } from "effect";

/**
 * The caller already has a pending blog request (409): a user has at most
 * one at a time. Withdraw it, or wait for the decision, before requesting
 * another subblog.
 */
export class BlogRequestAlreadyPending extends Schema.TaggedError<
  BlogRequestAlreadyPending,
  { readonly brand: unique symbol }
>()(
  "BlogRequestAlreadyPending",
  {},
  {
    httpApiStatus: 409,
    description: "The caller already has a pending blog request.",
  },
) {}
