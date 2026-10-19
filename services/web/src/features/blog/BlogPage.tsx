import { useAtomValue } from "@effect/atom-react";
import { type BlogSlug, Tag } from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { PenSquare, X } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { userAtom } from "#api/session.ts";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { Badge } from "#ui/Badge.tsx";
import { ButtonLink } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { Loading } from "#ui/Spinner.tsx";
import { blogAtom, postPageAtom } from "./blogAtoms.ts";
import { blogParam, canEdit } from "./editing.ts";
import { NoPosts, PostList } from "./PostList.tsx";

const decodeTag = Schema.decodeUnknownOption(Tag);

export function BlogPage() {
  const blog = blogParam(useParams().blog);
  if (Option.isNone(blog)) return <NotFoundPage what="blog" />;
  return <Blog blog={blog.value} />;
}

function Blog({ blog }: { readonly blog: BlogSlug }) {
  const user = useAtomValue(userAtom);
  const [search] = useSearchParams();
  const tag = Option.getOrUndefined(decodeTag(search.get("tag") ?? undefined));

  return (
    <AsyncView
      atom={blogAtom(blog)}
      loading={<Loading />}
      failure={(error) =>
        error === "BlogNotFound" ? <NotFoundPage what="blog" /> : undefined
      }
    >
      {(info) => (
        <Container>
          <PageHeader
            path={`~/blog/${blog}`}
            title={info.title}
            actions={
              canEdit(user, blog) && (
                <ButtonLink
                  to={`/blog/${blog}/manage`}
                  variant="primary"
                  icon={<PenSquare size={15} />}
                >
                  Write
                </ButtonLink>
              )
            }
          >
            {info.description}
          </PageHeader>
          {tag !== undefined && (
            <p className="mb-6 flex items-center gap-2 text-sm text-muted">
              Posts tagged
              <Badge tone="accent">#{tag}</Badge>
              <Link
                to={`/blog/${blog}`}
                className="inline-flex items-center gap-1 hover:text-fg"
              >
                <X size={14} /> all posts
              </Link>
            </p>
          )}
          <PostList
            key={tag ?? ""}
            page={(cursor) => postPageAtom(blog, { cursor, tag })}
            empty={
              <NoPosts>
                {tag === undefined
                  ? "Nothing published here yet."
                  : "No posts with this tag."}
              </NoPosts>
            }
          />
        </Container>
      )}
    </AsyncView>
  );
}
