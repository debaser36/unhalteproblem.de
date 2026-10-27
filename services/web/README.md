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
- `test` runs the unit and component tests (see Testing), `lint` oxlint.

## Layout

| Folder (alias)               | What lives there                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/app` (`#app/*`)         | The shell: router (every page is a lazily loaded chunk), layout, header, footer, user menu, `RequireUser`, `site.ts` |
| `src/api` (`#api/*`)         | The typed client (`ApiClient`), the session atoms, `AsyncView` and error messages                                    |
| `src/features/*`             | One folder per feature: `home`, `blog`, `projects`, `about`, `contact`, `account`, `admin`                           |
| `src/editor`                 | The rich document editor (TipTap), shared by posts and projects: viewer, toolbar, editor bar, cover picker           |
| `src/ui` (`#ui/*`)           | The design system: buttons, fields, cards, badges, dialogs, tables, toasts. No data, no features                     |
| `src/lib` (`#lib/*`)         | Small pure helpers (slugs, tags, formatting, theme), with tests                                                      |
| `src/styles`                 | Design tokens (dark and light theme), document typography and code colors                                            |
| `src/testing` (`#testing/*`) | Test helpers only: the fake backend, render helpers, fixtures                                                        |

Aliases map a folder without an extension (`"#ui/*": "./src/ui/*"`), and
imports name the file with its extension (`#ui/Button.tsx`), since most
folders mix `.ts` and `.tsx`. Features import from `ui`, `lib`, `api`,
`editor` and, sparingly, from each other's atoms; `ui` and `lib` import from
no feature.

## Testing

Three layers, all run in the dev shell (`nix develop`), which provides Chromium:

- **Unit tests** (`src/**/*.test.ts`) for pure modules, in Node.
- **Component tests** (`src/**/*.browser.test.tsx`) render components and
  pages in a real Chromium through Vitest Browser Mode (the editor needs real
  selections and layout). `fakeApi` (`#testing/FakeApi.ts`) replaces the
  `ApiClient` with handlers typed against the contract, so a contract change
  breaks the fakes at compile time; `renderApp(path, api)` renders the whole
  site with its routes, `renderWithApi(element, api)` one component.
  `callsTo(group, endpoint)` returns what a page sent. Both run with `test`.
- **End-to-end smoke tests** (`e2e/`, Playwright) run against the local
  stack: `pnpm test:e2e` from the root starts it with `stack up` if needed,
  logs in an admin and a plain user with `stack login` and creates the `e2e`
  blog. Each run adds a post and a contact message to the stack's database
  (`stack reset` clears it). Pages are checked for console errors, and the
  public pages with axe.

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
into the head. The builders, the site facts (`src/app/site.ts` re-exports
them), the metadata of the fixed pages and the `postSeo`, `projectSeo` and
`blogSeo` helpers live in `lib/seo` (`@unhalteproblem.de/seo`), because the
backend's crawler pages use them too. A new page needs `<Seo>` or `<NoIndex>`,
or it keeps the previous page's tags. The defaults in `index.html`
(`data-seo`) are for crawlers without JavaScript; a test keeps them equal to
the package. JSON-LD is serialized with `<` escaped, because posts and
projects are user content.

Crawlers and link-preview bots do not get the SPA at all: nginx sends them
server-rendered pages from the backend (`services/backend/docs/seo.md`), and
`/sitemap.xml` comes from the backend as well. `public/robots.txt` names it,
blocks the private paths and the API (except `/api/media/`).

## Content to fill in

- `src/features/about/profile.ts`: the about page (the experience entries
  are placeholders).
- `src/app/site.ts`: owner, domain, GitHub URL.
