import type { UserConfig } from "vite-plus";

type LintConfig = NonNullable<UserConfig["lint"]>;

// Design-system policy enforced by @shadcn/lint. Every exception below is a
// deliberate contract; prefer adding a variant in src/components/ui over
// widening one.
export const shadcnRules: LintConfig["rules"] = {
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
};

export const shadcnOverrides: LintConfig["overrides"] = [
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
];
