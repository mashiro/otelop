// The traces/metrics/logs tables render every row directly (no
// virtualization library — see CLAUDE.md's Workflow notes on not adding new
// dependencies without the user's say-so), so a live buffer sitting at its
// cap (stores/telemetry.ts's traceCap/metricCap/logCap — up to 1000/3000/5000)
// would otherwise mount thousands of <tr> elements at once, e.g. whenever the
// "all" time range or an empty search is selected.
//
// This bounds a *sliding* window (hooks/use-render-window.ts), not a static
// truncation: each list component (trace-list.tsx/log-list.tsx/
// metric-list.tsx) can page the window through history via "Load more"
// without ever mounting more than this many rows at once. See
// stores/telemetry.ts's renderWindowMaxAtom, which this seeds as its default.
export const LIST_DISPLAY_CAP = 500;
