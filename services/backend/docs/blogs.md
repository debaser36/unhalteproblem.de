# Blogs

The website has several subblogs (`blogs`), each with its posts
(`blog_posts`), in the domain `blogs`. Admins create and rename subblogs
(`POST /admin/blogs`, `PATCH /admin/blogs/:blog`); a subblog's slug never
changes, since it is in URLs and in roles. Its posts are written in place on
the website by the holders of **`blogEditor:<slug>`**, granted by superAdmins
like any role (`PUT /admin/users/:id/roles/blogEditor:<slug>`, 404
`BlogNotFound` for a subblog that doesn't exist, so no editor role waits for
one that might be created later), or by approving a user's blog request
(see below).

| Endpoints                                 | Who                 | Does                                                          |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `GET /blogs`, `/blogs/:blog`              | everyone            | Subblogs, with their number of published posts                |
| `GET /blogs/:blog/posts`, `/posts`        | everyone            | Published posts, sorted and filtered, paged by keyset cursor  |
| `GET /blogs/:blog/posts/:post`            | everyone            | One published post, by slug                                   |
| `/blogs/:blog/manage/posts[/:postId[/…]]` | `blogEditor:<blog>` | All posts, drafts included; create, save, (un)publish, delete |
| `POST /blogs/:blog/manage/media`          | `blogEditor:<blog>` | Uploads an image (see [media.md](media.md))                   |
| `PUT /blogs/:blog/manage/categories`      | `blogEditor:<blog>` | Sets the subblog's categories                                 |
| `GET /categories`                         | everyone            | All categories, with their subblogs and published posts       |
| `/admin/categories/:category[/merge]`     | `admin`             | Rename, merge into another, delete an unused one              |

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
  and their user id while their account exists; a deleted account's posts
  stay, without a name or id. The id is what `?author=` filters by.
- **Categories.** One list (`categories`) for subblogs and posts. Each has
  one main category (`main_category_id`) and up to three extras
  (`blog_extra_categories`, `blog_post_extra_categories`); the cap and
  "main is not an extra" are checked by the contract's `CategoriesInput`,
  not the database. Editors send names: a name is matched by its slug
  (`categorySlugOf`, so "Web dev" and "web-dev" are one category) and
  created if none exists, in the save's transaction (audit
  `category_created`). The categories used are locked `FOR KEY SHARE`, and
  admins' rename, merge and delete lock them `FOR UPDATE`, both in slug
  order. A new post's editor preselects the subblog's main category;
  approved blog requests start in `miscellaneous`. The migration seeds ten
  presets.
- **Sorting and filters.** `sort` is `newest` (default), `oldest`,
  `updated`, `title`, `readingTime` (by `word_count`, kept by a trigger),
  `category` (main category name, then newest) or `author` (name, unknown
  and deleted authors last, then newest). `category`, `author` and `tag`
  filter. The cursor carries the sort and its keys, so a cursor of one sort
  is refused (400) with another. The subblog list is unpaged and sorted in
  the browser.

Look at the posts of a subblog with
`SELECT p.slug, p.status, p.published_at, p.version FROM blog_posts p JOIN blogs b ON b.id = p.blog_id WHERE b.slug = '…' ORDER BY p.updated_at DESC`.

## Blog requests

Any logged-in user can ask for a subblog of their own on the website
(`/blog/~request`), with a title and a description (`blog_requests`,
`BlogRequestCommands` and `BlogRequestQueries` in the blogs domain). An
**admin or superAdmin** decides it in the admin panel:

| Endpoints                               | Who                     | Does                                                        |
| --------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| `GET /blog-requests`                    | any logged-in user      | The caller's own requests, newest first (the latest 50)     |
| `POST /blog-requests`                   | any logged-in user      | Asks for a subblog; 409 `BlogRequestAlreadyPending`         |
| `POST /blog-requests/:id/withdraw`      | the requester           | Withdraws their pending request                             |
| `GET /admin/blog-requests?status&limit` | `admin` or `superAdmin` | All requests (or those with `status`), newest first         |
| `POST /admin/blog-requests/:id/approve` | `admin` or `superAdmin` | Creates the subblog with the chosen slug, makes them editor |
| `POST /admin/blog-requests/:id/reject`  | `admin` or `superAdmin` | Rejects it, with an optional reason the requester sees      |

- **One at a time.** A user has at most one pending request (the partial
  unique index `blog_requests_one_pending_per_user`); a decided or
  withdrawn one is kept, so they can ask again.
- **Approval** happens in one transaction: the subblog is created with the
  request's title and description and the slug the moderator chose (409
  `BlogSlugTaken`), the requester gets `blogEditor:<slug>`
  (`ModerationCommands.grantApprovedBlogEditor`, logged in the role change
  log like any grant), and the request records the subblog. This is the one
  role an admin grants without being a superAdmin, and moderation grants it
  only to someone else and only for a subblog nobody edits yet. If the
  requester has
  deleted their account meanwhile, approval fails with 404 `UserNotFound`
  and nothing is created; reject the request instead.
- **Nobody decides their own request** (403 `Forbidden`): it would let an
  admin make themselves an editor. Approving re-checks the moderator under
  lock, like in moderation (a rejection grants nothing, so it goes by the
  request's proof). A request that is no longer pending answers 409
  `BlogRequestNotPending`.
- **Audit.** Approval writes `blog_created`, `role_granted` and
  `blog_request_approved` (target the requester, detail the slug); a
  rejection writes `blog_request_rejected` without the reason. The event
  log has ids only.

Look at open requests with
`SELECT id, requester_id, title, created_at FROM blog_requests WHERE status = 'pending' ORDER BY created_at`.
