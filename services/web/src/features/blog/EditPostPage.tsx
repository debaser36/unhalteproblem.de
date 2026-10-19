import { type BlogSlug, PostId } from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { useNavigate, useParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { RequireUser } from "#app/RequireUser.tsx";
import { blogEditorRole } from "@unhalteproblem.de/api";
import { Container } from "#ui/Container.tsx";
import { Loading } from "#ui/Spinner.tsx";
import { managedPostAtom } from "./blogAtoms.ts";
import { blogParam } from "./editing.ts";
import { PostEditor } from "./PostEditor.tsx";

const decodePostId = Schema.decodeUnknownOption(PostId);

/** Writing a new post, or editing a draft (published posts are edited on their page). */
export function EditPostPage() {
  const params = useParams();
  const blog = blogParam(params.blog);
  if (Option.isNone(blog)) return <NotFoundPage what="blog" />;
  return (
    <RequireUser role={blogEditorRole(blog.value)}>
      {() => (
        <Container width="prose">
          {params.postId === "new" ? (
            <NewPost blog={blog.value} />
          ) : (
            <ExistingPost blog={blog.value} postId={params.postId} />
          )}
        </Container>
      )}
    </RequireUser>
  );
}

function NewPost({ blog }: { readonly blog: BlogSlug }) {
  const navigate = useNavigate();
  return (
    <PostEditor
      blog={blog}
      post={null}
      onSaved={(post) =>
        navigate(`/blog/${blog}/edit/${post.id}`, { replace: true })
      }
      onClose={() => navigate(`/blog/${blog}/manage`)}
      onDeleted={() => navigate(`/blog/${blog}/manage`)}
    />
  );
}

function ExistingPost({
  blog,
  postId,
}: {
  readonly blog: BlogSlug;
  readonly postId: string | undefined;
}) {
  const navigate = useNavigate();
  const id = decodePostId(postId);
  if (Option.isNone(id)) return <NotFoundPage what="post" />;
  return (
    <AsyncView
      atom={managedPostAtom(blog, id.value)}
      loading={<Loading label="opening editor" />}
      failure={(error) =>
        error === "PostNotFound" ? <NotFoundPage what="post" /> : undefined
      }
    >
      {(post) => (
        <PostEditor
          key={post.id}
          blog={blog}
          post={post}
          onSaved={() => {}}
          onClose={() =>
            navigate(
              post.status === "published"
                ? `/blog/${blog}/${post.slug}`
                : `/blog/${blog}/manage`,
            )
          }
          onDeleted={() => navigate(`/blog/${blog}/manage`)}
        />
      )}
    </AsyncView>
  );
}
