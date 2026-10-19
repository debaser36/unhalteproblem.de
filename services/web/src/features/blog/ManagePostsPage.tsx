import { blogEditorRole, type BlogSlug } from "@unhalteproblem.de/api";
import { Option } from "effect";
import { ExternalLink, PenLine, Plus } from "lucide-react";
import { Link, useParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { RequireUser } from "#app/RequireUser.tsx";
import { formatDateTime } from "#lib/format.ts";
import { Badge } from "#ui/Badge.tsx";
import { ButtonLink } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import { managedPostsAtom } from "./blogAtoms.ts";
import { blogParam } from "./editing.ts";

/** An editor's desk: every post of the subblog, drafts included. */
export function ManagePostsPage() {
  const blog = blogParam(useParams().blog);
  if (Option.isNone(blog)) return <NotFoundPage what="blog" />;
  return (
    <RequireUser role={blogEditorRole(blog.value)}>
      {() => <Desk blog={blog.value} />}
    </RequireUser>
  );
}

function Desk({ blog }: { readonly blog: BlogSlug }) {
  return (
    <Container>
      <PageHeader
        path={`~/blog/${blog}/drafts`}
        title="Your desk"
        actions={
          <ButtonLink
            to={`/blog/${blog}/edit/new`}
            variant="primary"
            icon={<Plus size={15} />}
          >
            New post
          </ButtonLink>
        }
      >
        Every post of{" "}
        <Link to={`/blog/${blog}`} className="text-accent-2 hover:underline">
          {blog}
        </Link>
        , drafts included. Published posts are edited right on their page.
      </PageHeader>
      <AsyncView atom={managedPostsAtom(blog)}>
        {(posts) =>
          posts.length === 0 ? (
            <EmptyState
              title="Nothing written yet."
              action={
                <ButtonLink
                  to={`/blog/${blog}/edit/new`}
                  variant="primary"
                  icon={<Plus size={15} />}
                >
                  Write the first post
                </ButtonLink>
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Status</Th>
                  <Th>Last change</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="hover:bg-surface-2/50">
                    <Td>
                      <p className="font-medium text-fg">{post.title}</p>
                      <p className="font-mono text-xs text-muted">
                        /{post.slug}
                      </p>
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          post.status === "published" ? "accent" : "warning"
                        }
                      >
                        {post.status}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatDateTime(post.updatedAt)}
                      <span className="ml-2 font-mono text-xs text-muted">
                        v{post.version}
                      </span>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ButtonLink
                        size="sm"
                        variant="ghost"
                        to={`/blog/${blog}/edit/${post.id}`}
                        icon={<PenLine size={14} />}
                      >
                        Edit
                      </ButtonLink>
                      {post.status === "published" && (
                        <ButtonLink
                          size="sm"
                          variant="ghost"
                          to={`/blog/${blog}/${post.slug}`}
                          icon={<ExternalLink size={14} />}
                        >
                          View
                        </ButtonLink>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </AsyncView>
    </Container>
  );
}
