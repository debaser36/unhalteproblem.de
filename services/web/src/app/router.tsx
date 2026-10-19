import type { ComponentType } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { Layout } from "./Layout.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { RouteError } from "./RouteError.tsx";

/**
 * A route whose page is loaded on first visit, so each feature (and the
 * heavy editor) is its own chunk.
 */
const page = <M,>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType,
): Pick<RouteObject, "lazy"> => ({
  lazy: async () => ({ Component: pick(await load()) }),
});

export const routes: Array<RouteObject> = [
  {
    path: "/",
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            ...page(
              () => import("#features/home/HomePage.tsx"),
              (m) => m.HomePage,
            ),
          },
          {
            path: "blog",
            ...page(
              () => import("#features/blog/BlogIndexPage.tsx"),
              (m) => m.BlogIndexPage,
            ),
          },
          {
            path: "blog/:blog",
            ...page(
              () => import("#features/blog/BlogPage.tsx"),
              (m) => m.BlogPage,
            ),
          },
          {
            path: "blog/:blog/manage",
            ...page(
              () => import("#features/blog/ManagePostsPage.tsx"),
              (m) => m.ManagePostsPage,
            ),
          },
          {
            path: "blog/:blog/edit/:postId",
            ...page(
              () => import("#features/blog/EditPostPage.tsx"),
              (m) => m.EditPostPage,
            ),
          },
          {
            path: "blog/:blog/:post",
            ...page(
              () => import("#features/blog/PostPage.tsx"),
              (m) => m.PostPage,
            ),
          },
          {
            path: "projects",
            ...page(
              () => import("#features/projects/ProjectsPage.tsx"),
              (m) => m.ProjectsPage,
            ),
          },
          {
            path: "projects/:project",
            ...page(
              () => import("#features/projects/ProjectPage.tsx"),
              (m) => m.ProjectPage,
            ),
          },
          {
            path: "about",
            ...page(
              () => import("#features/about/AboutPage.tsx"),
              (m) => m.AboutPage,
            ),
          },
          {
            path: "contact",
            ...page(
              () => import("#features/contact/ContactPage.tsx"),
              (m) => m.ContactPage,
            ),
          },
          {
            path: "account",
            ...page(
              () => import("#features/account/AccountPage.tsx"),
              (m) => m.AccountPage,
            ),
          },
          {
            path: "admin/*",
            ...page(
              () => import("#features/admin/AdminApp.tsx"),
              (m) => m.AdminApp,
            ),
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
