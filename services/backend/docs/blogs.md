# Blogs

The website has several subblogs (`blogs`), each with its posts
(`blog_posts`), in the domain `blogs`. Admins create and rename subblogs
(`POST /admin/blogs`, `PATCH /admin/blogs/:blog`); a subblog's slug never
changes, since it is in URLs and in roles. Its posts are written in place on
the website by the holders of **`blogEditor:<slug>`**, granted by superAdmins
like any role (`PUT /admin/users/:id/roles/blogEditor:<slug>`, 404
`BlogNotFound` for a subblog that doesn't exist, so no editor role waits for
one that might be created later).

| Endpoints                                 | Who                 | Does                                                          |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `GET /blogs`, `/blogs/:blog`              | everyone            | Subblogs, with their number of published posts                |
| `GET /blogs/:blog/posts`, `/posts`        | everyone            | Published posts, newest first, paged by keyset cursor         |
| `GET /blogs/:blog/posts/:post`            | everyone            | One published post, by slug                                   |
| `/blogs/:blog/manage/posts[/:postId[/…]]` | `blogEditor:<blog>` | All posts, drafts included; create, save, (un)publish, delete |
| `POST /blogs/:blog/manage/media`          | `blogEditor:<blog>` | Uploads an image (see [media.md](media.md))                   |

- **Authorization.** The editor endpoints need a session (401) and the role
  for the subblog in their path (403); the handler provides
  `Authorized(blogEditorRole(blog))`, and every command and query requires
  the proof for the subblog it acts on. A proof for another subblog has the
  same type but a different service key, so it is missing at runtime: the
  request fails, it is never let through. Writes also need the website's
  `Origin`. Admins are not editors: an admin who wants to write grants
  themselves the role (which is logged).
- **Drafts and publishing.** A post is created as a draft and is only public
  while published. `published_at` is set at the first publication and kept
  when a post goes back to draft and is published again, so a republished
  post doesn't jump to the top of the feed.
- **Concurrent edits.** Every save sends the `version` it started from; if
  someone saved in between, it fails with 409 `PostEditConflict` (with the
  current version) instead of overwriting their work. Every change bumps the
  version.
- **Content.** Posts are TipTap (ProseMirror) JSON, validated by the
  contract's `Document` schema: a whitelist of node types, marks and
  attributes, links only to http(s), mailto or the site itself, images only
  from `/api/media/<id>`. No HTML is ever stored. Saving a post may send up
  to 512 KiB (`LargeBody`); nginx allows it on `/api/blogs/*/manage/` and
  `/api/admin/projects`.
- **Authors.** A post names its author (`users.name`, else the username)
  while their account exists; a deleted account's posts stay, without a
  name.

Look at the posts of a subblog with
`SELECT p.slug, p.status, p.published_at, p.version FROM blog_posts p JOIN blogs b ON b.id = p.blog_id WHERE b.slug = '…' ORDER BY p.updated_at DESC`.
