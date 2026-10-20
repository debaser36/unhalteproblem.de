import type { PostCursor, PostPage } from "@unhalteproblem.de/api";
import type { AsyncResult, Atom } from "effect/reactivity";
import { type ReactNode, useState } from "react";
import { AsyncView } from "#api/AsyncView.tsx";
import { Button } from "#ui/Button.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Skeleton } from "#ui/Skeleton.tsx";
import { PostCard } from "./PostCard.tsx";

export type PageAtom = (
  cursor: PostCursor | undefined,
) => Atom.Atom<AsyncResult.AsyncResult<PostPage, unknown>>;

/** A grid of post cards, a page at a time, with "load more". */
export function PostList({
  page,
  showBlog = false,
  paged = true,
  empty,
}: {
  readonly page: PageAtom;
  readonly showBlog?: boolean;
  /** Offers "load more" after the last page; off for a teaser. */
  readonly paged?: boolean;
  readonly empty: ReactNode;
}) {
  const [cursors, setCursors] = useState<ReadonlyArray<PostCursor | undefined>>(
    [undefined],
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        {cursors.map((cursor, index) => (
          <Page
            key={index}
            atom={page(cursor)}
            showBlog={showBlog}
            first={index === 0}
            empty={empty}
            onMore={
              paged && index === cursors.length - 1
                ? (next) => setCursors((all) => [...all, next])
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function Page({
  atom,
  showBlog,
  first,
  empty,
  onMore,
}: {
  readonly atom: Atom.Atom<AsyncResult.AsyncResult<PostPage, unknown>>;
  readonly showBlog: boolean;
  readonly first: boolean;
  readonly empty: ReactNode;
  readonly onMore: ((next: PostCursor) => void) | undefined;
}) {
  return (
    <AsyncView
      atom={atom}
      loading={
        <>
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </>
      }
    >
      {({ posts, nextCursor }) => (
        <>
          {first && posts.length === 0 && (
            <div className="sm:col-span-2">{empty}</div>
          )}
          {posts.map((post) => (
            <PostCard key={post.id} post={post} showBlog={showBlog} />
          ))}
          {onMore !== undefined && nextCursor !== null && (
            <div className="flex justify-center sm:col-span-2">
              <Button variant="secondary" onClick={() => onMore(nextCursor)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </AsyncView>
  );
}

export function NoPosts({ children }: { readonly children?: ReactNode }) {
  return <EmptyState title="No posts yet.">{children}</EmptyState>;
}
