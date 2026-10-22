import type { Blog } from "@unhalteproblem.de/api";
import { staticPages } from "@unhalteproblem.de/seo";
import { ArrowUpRight, BookPlus } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { Seo } from "#app/Seo.tsx";
import { formatDate } from "#lib/format.ts";
import { ButtonLink } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Container } from "#ui/Container.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Select } from "#ui/Field.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { Skeleton } from "#ui/Skeleton.tsx";
import { blogsAtom, recentPostsAtom } from "./blogAtoms.ts";
import { blogSorts, isBlogSort, sortBlogs } from "./blogSort.ts";
import { CategoryBadges } from "./CategoryBadges.tsx";
import { PostFilters } from "./PostFilters.tsx";
import { filterKey, usePostFilter } from "./postFilter.ts";
import { NoPosts, PostList } from "./PostList.tsx";

export function BlogIndexPage() {
  const [filter, setFilter] = usePostFilter();
  const [search, setSearch] = useSearchParams();
  const blogsParam = search.get("blogs");
  const blogSort = isBlogSort(blogsParam) ? blogsParam : "title";
  return (
    <Container>
      <Seo {...staticPages.blog} />
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

      <label className="mb-4 inline-flex items-center gap-2 text-sm text-muted">
        <span className="font-mono text-xs whitespace-nowrap uppercase">
          Blogs by
        </span>
        <Select
          className="w-auto"
          value={blogSort}
          onChange={(e) =>
            setSearch(
              (current) => {
                const next = new URLSearchParams(current);
                if (e.target.value === "title") next.delete("blogs");
                else next.set("blogs", e.target.value);
                return next;
              },
              { replace: true },
            )
          }
        >
          {Object.entries(blogSorts).map(([sort, label]) => (
            <option key={sort} value={sort}>
              {label}
            </option>
          ))}
        </Select>
      </label>

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
        {(all) => {
          const blogs = sortBlogs(all, blogSort, filter.category);
          return blogs.length === 0 ? (
            <EmptyState
              title={
                all.length === 0
                  ? "No subblogs yet."
                  : "No subblogs in this category."
              }
            >
              {all.length === 0 && "An admin creates them in the admin panel."}
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {blogs.map((blog) => (
                <BlogCard key={blog.slug} blog={blog} />
              ))}
            </div>
          );
        }}
      </AsyncView>

      <section aria-labelledby="latest" className="mt-16 space-y-6">
        <h2 id="latest" className="text-2xl font-semibold text-fg">
          <span className="font-mono text-accent">$</span> tail -f posts
        </h2>
        <PostFilters filter={filter} onChange={setFilter} />
        <PostList
          key={filterKey(filter)}
          showBlog
          page={(cursor) => recentPostsAtom({ ...filter, cursor })}
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
      <CategoryBadges categories={blog.categories} />
      <p className="mt-auto font-mono text-xs text-muted">
        {blog.postCount} {blog.postCount === 1 ? "post" : "posts"}
        {blog.latestPostAt !== null && (
          <> · last {formatDate(blog.latestPostAt)}</>
        )}
      </p>
    </Card>
  );
}
