import { useAtomValue } from "@effect/atom-react";
import type { BlogSlug } from "@unhalteproblem.de/api";
import { Option } from "effect";
import { PenSquare } from "lucide-react";
import { useParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { userAtom } from "#api/session.ts";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { ButtonLink } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { Loading } from "#ui/Spinner.tsx";
import { blogAtom, postPageAtom } from "./blogAtoms.ts";
import { CategoryBadges } from "./CategoryBadges.tsx";
import { blogParam, canEdit } from "./editing.ts";
import { PostFilters } from "./PostFilters.tsx";
import { filterKey, usePostFilter } from "./postFilter.ts";
import { NoPosts, PostList } from "./PostList.tsx";

export function BlogPage() {
  const blog = blogParam(useParams().blog);
  if (Option.isNone(blog)) return <NotFoundPage what="blog" />;
  return <Blog blog={blog.value} />;
}

function Blog({ blog }: { readonly blog: BlogSlug }) {
  const user = useAtomValue(userAtom);
  const [filter, setFilter] = usePostFilter();
  const filtered =
    filter.tag !== undefined ||
    filter.category !== undefined ||
    filter.author !== undefined;

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
          <CategoryBadges
            categories={info.categories}
            base={`/blog/${blog}`}
            className="-mt-4 mb-8"
          />
          <PostFilters filter={filter} onChange={setFilter} />
          <PostList
            key={filterKey(filter)}
            page={(cursor) => postPageAtom(blog, { ...filter, cursor })}
            empty={
              <NoPosts>
                {filtered
                  ? "No posts match these filters."
                  : "Nothing published here yet."}
              </NoPosts>
            }
          />
        </Container>
      )}
    </AsyncView>
  );
}
