import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { recentPostsAtom } from "#features/blog/blogAtoms.ts";
import { NoPosts, PostList } from "#features/blog/PostList.tsx";
import { FeaturedProjects } from "#features/projects/FeaturedProjects.tsx";
import { Container } from "#ui/Container.tsx";
import { Hero } from "./Hero.tsx";

function SectionHeading({
  title,
  to,
  more,
}: {
  readonly title: string;
  readonly to: string;
  readonly more: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <h2 className="text-2xl font-semibold text-fg sm:text-3xl">
        <span className="font-mono text-accent">#</span> {title}
      </h2>
      <Link
        to={to}
        className="inline-flex shrink-0 items-center gap-1 font-mono text-sm text-muted hover:text-accent"
      >
        {more} <ArrowRight size={14} />
      </Link>
    </div>
  );
}

export function HomePage() {
  return (
    <Container width="wide">
      <Hero />
      <section aria-label="Latest posts" className="mt-8">
        <SectionHeading title="Latest posts" to="/blog" more="all posts" />
        <PostList
          showBlog
          paged={false}
          page={(cursor) =>
            recentPostsAtom({ cursor, sort: "newest", limit: 4 })
          }
          empty={<NoPosts>The first post is still being written.</NoPosts>}
        />
      </section>
      <section aria-label="Projects" className="mt-20">
        <SectionHeading title="Projects" to="/projects" more="all projects" />
        <FeaturedProjects />
      </section>
    </Container>
  );
}
