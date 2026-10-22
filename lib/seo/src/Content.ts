import { site } from "./Site.ts";
import {
  blogPostingJsonLd,
  breadcrumbsJsonLd,
  projectJsonLd,
  type SeoInput,
} from "./Tags.ts";

/**
 * The SEO input of the pages that show stored content. The website and the
 * backend's crawler pages both build theirs here, so they cannot disagree
 * about titles, descriptions or structured data.
 */

export interface BlogSeoData {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
}

export const blogSeo = (blog: BlogSeoData): SeoInput => {
  const path = `/blog/${blog.slug}`;
  return {
    title: blog.title,
    description: blog.description,
    path,
    jsonLd: [
      breadcrumbsJsonLd(site.origin, [
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
        { name: blog.title, path },
      ]),
    ],
  };
};

export interface PostSeoData {
  readonly blog: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  /** The cover image's path (`mediaUrl`); `null` without one. */
  readonly image: string | null;
  /** ISO 8601 date-times. */
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly authorName: string | null;
  readonly tags: ReadonlyArray<string>;
  /** The name of the main category. */
  readonly category: string;
}

export const postSeo = (post: PostSeoData): SeoInput => {
  const path = `/blog/${post.blog}/${post.slug}`;
  const description =
    post.summary !== ""
      ? post.summary
      : `${post.title}, a post by ${post.authorName ?? site.owner}.`;
  const image = post.image ?? undefined;
  return {
    title: post.title,
    description,
    path,
    image,
    article: {
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      author: post.authorName,
      tags: post.tags,
    },
    jsonLd: [
      blogPostingJsonLd(site.origin, {
        path,
        title: post.title,
        description,
        image,
        publishedAt: post.publishedAt,
        updatedAt: post.updatedAt,
        author: post.authorName,
        tags: post.tags,
        section: post.category,
      }),
      breadcrumbsJsonLd(site.origin, [
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
        { name: post.blog, path: `/blog/${post.blog}` },
        { name: post.title, path },
      ]),
    ],
  };
};

export interface ProjectSeoData {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  /** The cover image's path (`mediaUrl`); `null` without one. */
  readonly image: string | null;
  readonly updatedAt: string;
  readonly repoUrl: string | null;
  readonly tags: ReadonlyArray<string>;
}

export const projectSeo = (project: ProjectSeoData): SeoInput => {
  const path = `/projects/${project.slug}`;
  const image = project.image ?? undefined;
  return {
    title: project.title,
    description:
      project.summary !== ""
        ? project.summary
        : `${project.title}, a project by ${site.owner}.`,
    path,
    image,
    jsonLd: [
      projectJsonLd(site.origin, {
        path,
        title: project.title,
        description: project.summary,
        image,
        updatedAt: project.updatedAt,
        repoUrl: project.repoUrl,
        tags: project.tags,
      }),
      breadcrumbsJsonLd(site.origin, [
        { name: "Home", path: "/" },
        { name: "Projects", path: "/projects" },
        { name: project.title, path },
      ]),
    ],
  };
};
