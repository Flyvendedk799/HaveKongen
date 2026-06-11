import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  build: {
    // Bundle every page's CSS into a single, always-loaded stylesheet instead of
    // per-route chunks. Route-level CSS chunks were not being applied in
    // production (global styles loaded, page styles did not), leaving pages like
    // Havekompagnon unstyled. Disabling code-splitting guarantees the CSS ships
    // with the global bundle that is statically linked in index.html.
    cssCodeSplit: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
