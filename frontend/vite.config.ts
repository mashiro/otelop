import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

const generatedSources = ["src/gql/**"];

// Overridable so e2e verification runs can point the dev proxy at an
// isolated backend instance instead of the developer's live :4319 server
// (see mise-tasks/e2e-env). The ws:// target is derived from the same
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
      // class-variance-authority still imports clsx; route it to cn so the
      // bundle carries a single class-joining implementation.
      clsx: "cn",
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
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }, "@shadcn/lint"],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "shadcn/no-restyle": [
        "error",
        {
          allow: ["layout"],
          contracts: [
            {
              // PopoverContent is a layout container at every call site (the
              // filter-edit popovers); its internal gap/padding is page
              // content, not component chrome.
              pattern: "^PopoverContent$",
              allow: ["layout", "spacing"],
            },
            {
              // Icon-adorned search inputs need inset padding for a
              // leading icon and/or trailing clear button; the filter-key
              // input displays a code-like dot-path value in monospace.
              pattern: "^Input$",
              allow: ["layout", "font-mono", "pl-7", "pr-7", "text-xs"],
            },
            {
              // FieldGroup here lays out a whole filter-edit form; its gap
              // is form layout, not component chrome.
              pattern: "^FieldGroup$",
              allow: ["layout", "spacing"],
            },
            {
              pattern: "^Button$",
              allow: [
                "layout",
                // signal-filter-bar.tsx:108's filter-chip edit trigger (sm
                // size + inline-start icon + label) widens sm's gap-1 —
                // same shape as the trace-detail Logs button that
                // originally motivated this entry (now removed there).
                "gap-1.5",
                // signal-filter-bar.tsx: leading segment of a manually
                // joined 3-button filter-chip row; squares its trailing
                // corner to match its siblings — not a reusable Button look.
                "rounded-r-none",
                // add-filter-button.tsx: AddFilterButton only reveals
                // itself once its filter-field wrapper is hovered/focused;
                // this opacity reveal is inherent to that one instance,
                // not a reusable Button look.
                "opacity-0",
                "group-hover/filter-field:opacity-100",
                "group-focus-within/filter-field:opacity-100",
              ],
            },
            {
              // App.tsx's Tabs is the page's top-level nav shell; its outer
              // gap/padding belongs to the page, not the component.
              pattern: "^Tabs$",
              allow: ["layout", "spacing"],
            },
            {
              // Shows a formatted duration (trace range-slider thumb);
              // monospace matches the numeric formatting used elsewhere.
              pattern: "^TooltipContent$",
              allow: ["layout", "font-mono"],
            },
          ],
        },
      ],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": [
        "error",
        {
          allow: [
            // Selected-span detail panel's responsive split height; no
            // fixed-scale token represents a viewport-relative percentage.
            "h-[45%]",
            // Container-query column collapse for narrow list toolbars; no
            // fixed-column scale token represents it.
            "@min-[48rem]/list:grid-cols-[minmax(0,1fr)_auto]",
            // Stat tiles auto-fill the available width at a 180px minimum
            // column; no fixed-column scale token represents it.
            "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]",
          ],
          contracts: [
            {
              // Keeps the filter popover inside the viewport on narrow
              // screens; no scale token represents 100vw minus a fixed
              // gutter.
              pattern: "^PopoverContent$",
              allow: ["max-w-[calc(100vw-2rem)]"],
            },
          ],
        },
      ],
      "shadcn/no-inline-styles": [
        "error",
        {
          // Waterfall bar/tick/thumb positions, span-range slider markers,
          // and per-series/per-status colors are computed from telemetry
          // data or measured layout at render time — no fixed set of
          // classes can represent them (span-waterfall.tsx, trace-overview
          // .tsx, metric-chart.tsx, metric-summary.tsx).
          allow: [
            "left",
            "top",
            "width",
            "height",
            "background",
            "backgroundColor",
            "borderColor",
            "color",
            "gridTemplateColumns",
            "paddingLeft",
          ],
        },
      ],
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
    },
    overrides: [
      {
        files: ["src/components/ui/**"],
        rules: {
          "shadcn/no-restyle": "off",
          "shadcn/no-arbitrary-values": "off",
          "shadcn/require-static-classes": "off",
        },
      },
      {
        // The logo's brand colors are fixed; theme tokens shift between light and dark.
        files: ["src/components/ui/logo.tsx"],
        rules: { "shadcn/no-raw-colors": "off" },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
