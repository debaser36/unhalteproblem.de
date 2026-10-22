import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In production nginx serves the site and proxies /api/ to the backend,
// stripping the prefix. The dev server does the same, so the browser talks
// to one origin in both cases and the session cookie just works.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: backend,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Production serves the sitemap from the backend too.
      "/sitemap.xml": backend,
    },
  },
  build: {
    rollupOptions: {
      output: {
        // The editor (ProseMirror, lowlight) is the heaviest part and only
        // needed on post and project pages; keep it out of the entry chunk.
        manualChunks: (id) =>
          /node_modules\/(@tiptap|prosemirror|lowlight|highlight\.js)/.test(id)
            ? "editor"
            : undefined,
      },
    },
  },
});
