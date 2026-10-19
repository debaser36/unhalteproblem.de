import { blogEditorRole, BlogSlug, type User } from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { hasRole } from "#api/session.ts";

/** Whether `user` may write in subblog `blog` (the backend decides; this only shows the controls). */
export const canEdit = (user: User | null, blog: BlogSlug): boolean =>
  hasRole(user, blogEditorRole(blog));

const decodeSlug = Schema.decodeUnknownOption(BlogSlug);

/** The subblog slug of a route parameter, if it is one. */
export const blogParam = (value: string | undefined): Option.Option<BlogSlug> =>
  decodeSlug(value);
