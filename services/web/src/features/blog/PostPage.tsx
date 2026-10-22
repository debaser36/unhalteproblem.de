import { useAtomValue } from "@effect/atom-react";
import {
  mediaUrl,
  type BlogSlug,
  type PublishedPost,
} from "@unhalteproblem.de/api";
import { blogPostingJsonLd, breadcrumbsJsonLd } from "@unhalteproblem.de/seo";
import { DateTime, Option } from "effect";
import { ArrowLeft, PenLine } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { userAtom } from "#api/session.ts";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { Seo } from "#app/Seo.tsx";
import { site } from "#app/site.ts";
import { toEditorContent } from "#editor/convert.ts";
import { RichDocument } from "#editor/RichDocument.tsx";
import { Button } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { Loading } from "#ui/Spinner.tsx";
import { managedPostAtom, postAtom } from "./blogAtoms.ts";
import { blogParam, canEdit } from "./editing.ts";
import { PostEditor } from "./PostEditor.tsx";
import { PostHeader } from "./PostHeader.tsx";

export function PostPage() {
  const params = useParams();
  const blog = blogParam(params.blog);
  if (Option.isNone(blog) || params.post === undefined)
    return <NotFoundPage what="post" />;
  return <Post blog={blog.value} slug={params.post} />;
}

function Post({
  blog,
  slug,
}: {
  readonly blog: BlogSlug;
  readonly slug: string;
}) {
  const user = useAtomValue(userAtom);
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();

  return (
    <Container width="prose">
      <AsyncView
        atom={postAtom(blog, slug)}
        loading={<Loading />}
        failure={(error) =>
          error === "PostNotFound" || error === "BlogNotFound" ? (
            <NotFoundPage what="post" />
          ) : undefined
        }
      >
        {(post) =>
          editing ? (
            <AsyncView
              atom={managedPostAtom(blog, post.id)}
              loading={<Loading label="opening editor" />}
            >
              {(managed) => (
                <PostEditor
                  key={managed.id}
                  blog={blog}
                  post={managed}
                  onSaved={(saved) => {
                    // A new slug moves the post; follow it.
                    if (saved.status === "published" && saved.slug !== slug) {
                      navigate(`/blog/${blog}/${saved.slug}`, {
                        replace: true,
                      });
                    }
                    if (saved.status === "draft") {
                      navigate(`/blog/${blog}/edit/${saved.id}`, {
                        replace: true,
                      });
                    }
                  }}
                  onClose={() => setEditing(false)}
                  onDeleted={() => navigate(`/blog/${blog}`)}
                />
              )}
            </AsyncView>
          ) : (
            <Reading
              post={post}
              onEdit={canEdit(user, blog) ? () => setEditing(true) : undefined}
            />
          )
        }
      </AsyncView>
    </Container>
  );
}

function Reading({
  post,
  onEdit,
}: {
  readonly post: PublishedPost;
  readonly onEdit: (() => void) | undefined;
}) {
  const path = `/blog/${post.blog}/${post.slug}`;
  const image =
    post.coverImage === null ? undefined : mediaUrl(post.coverImage);
  const publishedAt = DateTime.formatIso(post.publishedAt);
  const updatedAt = DateTime.formatIso(post.updatedAt);
  const description =
    post.summary !== ""
      ? post.summary
      : `${post.title}, a post by ${post.author.name ?? site.owner}.`;
  return (
    <article className="animate-fade-up">
      <Seo
        title={post.title}
        description={description}
        path={path}
        image={image}
        article={{
          publishedAt,
          updatedAt,
          author: post.author.name,
          tags: post.tags,
        }}
        jsonLd={[
          blogPostingJsonLd(site.origin, {
            path,
            title: post.title,
            description,
            image,
            publishedAt,
            updatedAt,
            author: post.author.name,
            tags: post.tags,
            section: post.categories.main.name,
          }),
          breadcrumbsJsonLd(site.origin, [
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
            { name: post.blog, path: `/blog/${post.blog}` },
            { name: post.title, path },
          ]),
        ]}
      />
      <PostHeader
        blog={post.blog}
        publishedAt={post.publishedAt}
        readingMinutes={post.readingMinutes}
        author={post.author}
        tags={post.tags}
        categories={post.categories}
        coverImage={post.coverImage}
        aside={
          onEdit !== undefined && (
            <Button
              size="sm"
              variant="secondary"
              icon={<PenLine size={14} />}
              onClick={onEdit}
            >
              Edit in place
            </Button>
          )
        }
        title={
          <h1 className="text-4xl leading-tight font-semibold text-fg sm:text-5xl">
            {post.title}
          </h1>
        }
        summary={
          post.summary !== "" && (
            <p className="text-xl text-fg-soft">{post.summary}</p>
          )
        }
      />
      {/* Keyed by version: a newer version replaces the read-only document. */}
      <RichDocument
        key={post.updatedAt.epochMilliseconds}
        content={toEditorContent(post.content)}
      />
      <footer className="mt-16 border-t border-border pt-6">
        <Link
          to={`/blog/${post.blog}`}
          className="inline-flex items-center gap-2 font-mono text-sm text-muted hover:text-fg"
        >
          <ArrowLeft size={14} /> cd ~/blog/{post.blog}
        </Link>
      </footer>
    </article>
  );
}
