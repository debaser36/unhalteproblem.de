# Media

Images for posts are uploaded with `POST /blogs/:blog/manage/media`
(multipart, one part `file`, at most 5 MiB) and stored in Postgres
(`media`, domain `media`), with the scope they were uploaded for
(`blog:<slug>`; project images, uploaded with `POST /admin/projects/media`,
get `projects`). The type is detected from the content (PNG, JPEG, GIF,
WebP, AVIF; 415 otherwise), never taken from the client; SVG is refused on
purpose, since it can carry script. `media.sha256` must be the SHA-256 of
the data (a check).

`GET /media/:mediaId` serves an image to everyone who knows its id, also
when it belongs to a draft: ids are random UUIDs, and whoever has the
draft's text can see its images anyway. The response may be cached for good
(an image never changes under its id) and carries `nosniff`, a sandboxing
CSP and `Cross-Origin-Resource-Policy: same-origin`. Nothing deletes images
yet, not even ones no post uses any more; find those with
`SELECT id, byte_size, uploaded_at FROM media m WHERE NOT EXISTS (SELECT 1 FROM blog_posts p WHERE p.cover_media_id = m.id OR p.content::text LIKE '%' || m.id || '%')`.
