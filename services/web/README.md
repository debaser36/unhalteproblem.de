# @unhalteproblem.de/website

The website: a React single-page app (Vite, Tailwind CSS v4) that talks to
the backend only through the shared contract
[`@unhalteproblem.de/api`](../../lib/api). It has a blog with subblogs, a
projects page, an about page, a contact form, the account page and the admin
panel. Posts and projects are written **in place**: their editors see the
page as readers do and switch it into an editor.

## Running

- `pnpm --filter @unhalteproblem.de/website dev` starts Vite on
  <http://localhost:5173>. Requests to `/api/*` are proxied to the backend
  (`BACKEND_URL`, default `http://127.0.0.1:3000`) with the prefix stripped,
  exactly like nginx does in production, so the session cookie just works.
- `build` type-checks and bundles into `dist/`, which nginx serves; every
  unknown path must fall back to `index.html` (client-side routing).
- `test` runs the unit tests (vitest), `lint` oxlint.

## Layout

| Folder (alias)       | What lives there                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/app` (`#app/*`) | The shell: router (every page is a lazily loaded chunk), layout, header, footer, user menu, `RequireUser`, `site.ts` |
| `src/api` (`#api/*`) | The typed client (`ApiClient`), the session atoms, `AsyncView` and error messages                                    |
| `src/features/*`     | One folder per feature: `home`, `blog`, `projects`, `about`, `contact`, `account`, `admin`                           |
| `src/editor`         | The rich document editor (TipTap), shared by posts and projects: viewer, toolbar, editor bar, cover picker           |
| `src/ui` (`#ui/*`)   | The design system: buttons, fields, cards, badges, dialogs, tables, toasts. No data, no features                     |
| `src/lib` (`#lib/*`) | Small pure helpers (slugs, tags, formatting, theme), with tests                                                      |
| `src/styles`         | Design tokens (dark and light theme), document typography and code colors                                            |

Aliases map a folder without an extension (`"#ui/*": "./src/ui/*"`), and
imports name the file with its extension (`#ui/Button.tsx`), since most
folders mix `.ts` and `.tsx`. Features import from `ui`, `lib`, `api`,
`editor` and, sparingly, from each other's atoms; `ui` and `lib` import from
no feature.

## Data

`ApiClient` (`effect/reactivity`'s `AtomHttpApi`) is generated from the
contract: `ApiClient.query(group, endpoint, request)` is an atom of the
response, `ApiClient.mutation(group, endpoint)` an atom function for writes.
Queries carry `reactivityKeys`, and every mutation names the keys it makes
stale, so lists refresh by themselves after a save (`blogAtoms.ts`,
`projectAtoms.ts`, `insightsAtoms.ts`). `AsyncView` renders a query's
loading, error and success states. The session is an atom too
(`sessionAtom`); hiding controls from users without a role is only a
courtesy, the backend checks every request.

## Editing in place

Posts and projects are TipTap (ProseMirror) documents, stored as JSON. The
editor's extensions (`editor/extensions.ts`) mirror the contract's
`Document` schema; before a save the content is decoded with that schema
(`editor/convert.ts`), so the backend never sees what it would refuse.
Images are uploaded through the API and referenced as `/api/media/<id>`.
Saves send the version they started from; if someone saved in between, the
editor says so instead of overwriting their work.

## SEO

Every routed page renders `<Seo>` (`src/app/Seo.tsx`), or `<NoIndex>` for
private and utility pages (account, admin, editors, forms, 404). It writes the
title, description, canonical link, Open Graph and Twitter tags and JSON-LD
into the head; `buildSeo` and the JSON-LD builders in `src/lib/seo.ts` are pure
and tested. A new page needs one of the two, or it keeps the previous page's
tags. Site-wide facts (origin, name, full name, default image) are in `src/app/site.ts`;
the defaults in `index.html` (`data-seo`) are for crawlers without JavaScript.
JSON-LD is serialized with `<` escaped, because posts and projects are user content.

`public/robots.txt` blocks the private paths and the API (except
`/api/media/`). `public/sitemap.xml` lists the static pages only: posts,
subblogs and projects are found through links, and a generated sitemap would
need a backend endpoint plus an nginx location.

## Content to fill in

- `src/features/about/profile.ts`: the about page (the experience entries
  are placeholders).
- `src/app/site.ts`: owner, domain, GitHub URL.
