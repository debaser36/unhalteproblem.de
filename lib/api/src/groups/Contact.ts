import { ContactMessage } from "#domain/ContactMessage";
import { RateLimited } from "#errors/RateLimited";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/** The website's contact form. */
export class ContactGroup extends HttpApiGroup.make("contact")
  .add(
    // Public on purpose: this is the contact form for anonymous website
    // visitors, so there is no account to authenticate. Abuse is handled by
    // rate limiting (`RateLimited`), not by auth.
    HttpApiEndpoint.post("submit", "/contact", {
      payload: ContactMessage,
      // 202 Accepted without a body: the message is handed off for delivery
      // (mail, queue) and the client only needs to know it was accepted. No
      // id or echo is returned, so nothing internal leaks to an anonymous
      // caller.
      success: HttpApiSchema.Accepted,
      // Invalid payloads are rejected by the framework's schema validation
      // (400) before the handler runs, so no custom validation error is
      // declared.
      error: RateLimited,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Send a contact message",
        description:
          "Accepts a message from the website's contact form for delivery. " +
          "Responds with 202 and no body once the message has been accepted.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Contact",
      description: "The website's contact form.",
    }),
  ) {}
