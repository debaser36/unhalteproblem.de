import { Outlet, ScrollRestoration } from "react-router";
import { Footer } from "./Footer.tsx";
import { Header } from "./Header.tsx";
import { Toaster } from "#ui/Toast.tsx";

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1 pb-24">
        <Outlet />
      </main>
      <Footer />
      <Toaster />
      <ScrollRestoration />
    </div>
  );
}
