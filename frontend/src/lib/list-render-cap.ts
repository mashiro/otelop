// The traces/metrics/logs tables render every row directly (no
// virtualization library — see CLAUDE.md's Workflow notes on not adding new
// dependencies without the user's say-so), so a live buffer sitting at its
// cap (stores/telemetry.ts's traceCap/metricCap/logCap — up to 1000/3000/5000)
// would otherwise mount thousands of <tr> elements at once, e.g. whenever the
// "all" time range or an empty search is selected. This bounds how many of a
// filtered list's rows actually mount; components/common/list-overflow-notice.tsx
// reports how many were left out.
export const LIST_DISPLAY_CAP = 500;
