export type SignalKey = "traces" | "metrics" | "logs";

// Signal-specific Tailwind class literals. Tailwind v4 scans source files for
// exact class tokens, so we keep all combinations here as plain strings.
// Using `bg-${token}/10` at call sites would fail to produce the class.
export interface SignalClasses {
  bgLight: string; // bg-{token}/10
  bgMedium: string; // bg-{token}/15
  text: string; // text-{token}
  textMuted: string; // text-{token}/70
  hoverBgFaint: string; // hover:bg-{token}/5
}

export interface SignalConfig {
  key: SignalKey;
  label: string;
  singular: string;
  // Tailwind color token. Used for constructing class names; the actual
  // literals live in `classes`.
  token: "trace" | "metric" | "log";
  classes: SignalClasses;
  // Matching CSS custom property for the signal's accent color, usable as `stroke`.
  cssVar: "--trace" | "--metric" | "--log";
  // Short label used in compact counters (header badge).
  shortLabel: string;
  // SVG path string for the decorative icon used in empty states. Intentionally
  // simple so it renders at any size with currentColor / CSS var strokes.
  iconPaths: string[];
  // Empty-state copy.
  emptyTitle: string;
  emptyHint: string;
}

export const SIGNALS: Record<SignalKey, SignalConfig> = {
  traces: {
    key: "traces",
    label: "Traces",
    singular: "trace",
    token: "trace",
    classes: {
      bgLight: "bg-trace/10",
      bgMedium: "bg-trace/15",
      text: "text-trace",
      textMuted: "text-trace/70",
      hoverBgFaint: "hover:bg-trace/5",
    },
    cssVar: "--trace",
    shortLabel: "T",
    iconPaths: ["M3 12h4l3-9 4 18 3-9h4"],
    emptyTitle: "No traces yet",
    emptyHint: "Send OTLP data to see them here",
  },
  metrics: {
    key: "metrics",
    label: "Metrics",
    singular: "metric",
    token: "metric",
    classes: {
      bgLight: "bg-metric/10",
      bgMedium: "bg-metric/15",
      text: "text-metric",
      textMuted: "text-metric/70",
      hoverBgFaint: "hover:bg-metric/5",
    },
    cssVar: "--metric",
    shortLabel: "M",
    iconPaths: ["M3 3v18h18", "M7 16l4-8 4 4 6-10"],
    emptyTitle: "No metrics yet",
    emptyHint: "Send OTLP data to see them here",
  },
  logs: {
    key: "logs",
    label: "Logs",
    singular: "log",
    token: "log",
    classes: {
      bgLight: "bg-log/10",
      bgMedium: "bg-log/15",
      text: "text-log",
      textMuted: "text-log/70",
      hoverBgFaint: "hover:bg-log/5",
    },
    cssVar: "--log",
    shortLabel: "L",
    iconPaths: ["M4 6h16M4 12h16M4 18h10"],
    emptyTitle: "No logs yet",
    emptyHint: "Send OTLP data to see them here",
  },
};

export const SIGNAL_LIST: SignalConfig[] = [SIGNALS.traces, SIGNALS.metrics, SIGNALS.logs];
