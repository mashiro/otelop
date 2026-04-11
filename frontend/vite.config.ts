import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

const generatedSources = ["src/gql/**"];

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
  },
  server: {
    proxy: {
      "/graphql": "http://localhost:4319",
      "/ws": {
        target: "http://localhost:4319",
        ws: true,
      },
    },
  },
  fmt: { ignorePatterns: generatedSources },
  lint: {
    ignorePatterns: generatedSources,
    options: { typeAware: true, typeCheck: true },
  },
});
