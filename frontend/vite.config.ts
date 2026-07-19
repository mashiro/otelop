import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

const generatedSources = ["src/gql/**"];

// Overridable so e2e verification runs can point the dev proxy at an
// isolated backend instance instead of the developer's live :4319 server
// (see .mise/tasks/e2e-env). The ws:// target is derived from the same
// origin rather than duplicated, so the two proxies can never drift apart.
// 127.0.0.1, not localhost: the backend now binds loopback-only
// (internal/config.DefaultHTTPAddr), and Node's DNS resolution order can
// try ::1 first, which the IPv4-only bind won't accept.
const backendOrigin = process.env.OTELOP_BACKEND_ORIGIN ?? "http://127.0.0.1:4319";
const backendWsOrigin = backendOrigin.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    proxy: {
      "/graphql": backendOrigin,
      "/ws": {
        target: backendWsOrigin,
        ws: true,
      },
    },
  },
  fmt: { ignorePatterns: generatedSources },
  lint: {
    ignorePatterns: generatedSources,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    environment: "happy-dom",
  },
});
