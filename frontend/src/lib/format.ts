export function formatDuration(ns: number): string {
  if (ns < 1_000) return `${ns}ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)}µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(1)}ms`;
  return `${(ns / 1_000_000_000).toFixed(2)}s`;
}

/** Create a formatter that uses a fixed unit based on the total duration. */
export function createDurationFormatter(totalNs: number): (ns: number) => string {
  if (totalNs < 1_000) return (ns) => `${Math.round(ns)}ns`;
  if (totalNs < 1_000_000) return (ns) => `${(ns / 1_000).toFixed(1)}µs`;
  if (totalNs < 1_000_000_000) return (ns) => `${(ns / 1_000_000).toFixed(1)}ms`;
  return (ns) => `${(ns / 1_000_000_000).toFixed(2)}s`;
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1_000) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

const ZERO_TRACE_ID = "00000000000000000000000000000000";

export function isZeroID(id: string): boolean {
  return !id || id === ZERO_TRACE_ID || id === "0000000000000000";
}

export function shortID(id: string, len = 16): string {
  return id.slice(0, len);
}
