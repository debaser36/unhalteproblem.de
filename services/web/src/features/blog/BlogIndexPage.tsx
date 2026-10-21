import type { Blog } from "@unhalteproblem.de/api";
import { ArrowUpRight, BookPlus } from "lucide-react";
import { Link } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { formatDate } from "#lib/format.ts";
import { ButtonLink } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Container } from "#ui/Container.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { Skeleton } from "#ui/Skeleton.tsx";
import { blogsAtom, recentPostsAtom } from "./blogAtoms.ts";
import { NoPosts, PostList } from "./PostList.tsx";

export function BlogIndexPage() {
  return (
    <Container>
      <PageHeader
        path="~/blog"
        title="Blog"
        actions={
          <ButtonLink
            to="/blog/~request"
            variant="secondary"
            icon={<BookPlus size={15} />}
          >
            Start your own
          </ButtonLink>
        }
      >
        Write-ups, notes and the occasional rant, sorted into a few subblogs.
        Pick one, or read everything below.
      </PageHeader>

      <AsyncView
        atom={blogsAtom}
        loading={
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        }
      >
        {(blogs) =>
          blogs.length === 0 ? (
            <EmptyState title="No subblogs yet.">
              An admin creates them in the admin panel.
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {blogs.map((blog) => (
                <BlogCard key={blog.slug} blog={blog} />
              ))}
            </div>
          )
        }
      </AsyncView>

      <section aria-labelledby="latest" className="mt-16 space-y-6">
        <h2 id="latest" className="text-2xl font-semibold text-fg">
          <span className="font-mono text-accent">$</span> tail -f posts
        </h2>
        <PostList
          showBlog
          page={(cursor) => recentPostsAtom({ cursor, tag: undefined })}
          empty={<NoPosts />}
        />
      </section>
    </Container>
  );
}

function BlogCard({ blog }: { readonly blog: Blog }) {
  return (
    <Card interactive className="group relative flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg group-hover:text-accent">
          <Link
            to={`/blog/${blog.slug}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {blog.title}
          </Link>
        </h2>
        <ArrowUpRight
          size={18}
          className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent"
        />
      </div>
      {blog.description !== "" && (
        <p className="line-clamp-3 text-sm text-fg-soft">{blog.description}</p>
      )}
      <p className="mt-auto font-mono text-xs text-muted">
        {blog.postCount} {blog.postCount === 1 ? "post" : "posts"}
        {blog.latestPostAt !== null && (
          <> · last {formatDate(blog.latestPostAt)}</>
        )}
      </p>
    </Card>
  );
}
