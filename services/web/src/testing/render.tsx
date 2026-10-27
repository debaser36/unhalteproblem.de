import { RegistryContext, scheduleTask } from "@effect/atom-react";
import type { ReactNode } from "react";
import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
} from "react-router";
import { AtomRegistry } from "effect/reactivity";
import { onTestFinished } from "vitest";
import { render } from "vitest-browser-react";
import { ApiClient } from "#api/ApiClient.ts";
import { routes } from "#app/router.tsx";
import { Toaster } from "#ui/Toast.tsx";
import { type FakeApi, fakeApi } from "./FakeApi.ts";

// A registry per test that is never disposed (unlike `RegistryProvider`'s):
// timers that outlive a test, like a toast hiding itself, then write to a
// registry nobody reads instead of failing.
const withApi = (api: FakeApi, children: ReactNode) => (
  <RegistryContext.Provider
    value={AtomRegistry.make({
      // React's scheduler, as `RegistryProvider` uses it.
      scheduleTask,
      initialValues: [[ApiClient.runtime.layer, api.layer]],
    })}
  >
    {children}
  </RegistryContext.Provider>
);

/**
 * Renders the whole site (layout, header, routing) at `path`, talking to
 * `api`. Use it for pages and for anything that depends on the route.
 */
export const renderApp = async (path: string, api: FakeApi = fakeApi()) => {
  // A browser router on the test page's own history, so that code reading
  // `window.location` (the login's `returnTo`) sees the route too.
  const original = window.location.href;
  window.history.replaceState(null, "", path);
  onTestFinished(() => window.history.replaceState(null, "", original));
  const router = createBrowserRouter(routes);
  onTestFinished(() => router.dispose());
  const screen = await render(withApi(api, <RouterProvider router={router} />));
  return { screen, router, api };
};

/**
 * Renders one component on its own, inside a router (for `Link`) and with
 * the toasts, talking to `api`.
 */
export const renderWithApi = async (
  ui: ReactNode,
  api: FakeApi = fakeApi(),
) => {
  const router = createMemoryRouter([
    {
      path: "*",
      element: (
        <>
          {ui}
          <Toaster />
        </>
      ),
    },
  ]);
  const screen = await render(withApi(api, <RouterProvider router={router} />));
  return { screen, router, api };
};
