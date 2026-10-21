# Projects

The projects page shows the owner's projects (`projects`, domain
`projects`): a write-up each (a `Document`, like posts), links to the source
(`repoUrl`) and to the project itself (`liveUrl`), tags, a status (`active`,
`completed`, `archived`) and an optional cover. Admins write them in place
on the website (`/admin/projects`, `RequireAdmin`, writes with the website's
`Origin`); only published ones are public (`GET /projects`,
`GET /projects/:project`). The page lists featured projects first, then by
`position` (ascending), then the most recently changed. Saves carry the
version they started from, as for posts (409 `ProjectEditConflict`).
Images go to the media store with the scope `projects`
(`POST /admin/projects/media`). URLs must be absolute http(s) URLs without
credentials; the database checks the scheme as well.
