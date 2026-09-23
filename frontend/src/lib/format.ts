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

// formatRelativeTime handles both directions (a future iso — e.g. the next
// scheduled retention sweep — as well as a past one) so callers never need
// a second "in ..." formatter alongside this one.
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  if (abs < 1_000) return "now";
  if (abs < 60_000)
    return future ? `in ${Math.floor(abs / 1_000)}s` : `${Math.floor(abs / 1_000)}s ago`;
  if (abs < 3_600_000)
    return future ? `in ${Math.floor(abs / 60_000)}m` : `${Math.floor(abs / 60_000)}m ago`;
  if (abs < 86_400_000)
    return future ? `in ${Math.floor(abs / 3_600_000)}h` : `${Math.floor(abs / 3_600_000)}h ago`;
  return future ? `in ${Math.floor(abs / 86_400_000)}d` : `${Math.floor(abs / 86_400_000)}d ago`;
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

// formatDateTime is formatTimestamp's date-qualified counterpart, for
// timestamps that can be far enough from "now" (e.g. days) that time-of-day
// alone is ambiguous. No fractional seconds — callers needing that
// precision want formatTimestamp instead.
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// formatElapsedMs is a human-scale duration formatter for millisecond
// spans that can range from sub-second (a sweep's duration) to days (server
// uptime) — unlike formatDuration/createDurationFormatter (nanosecond spans
// always shown to sub-integer precision, e.g. "3600.00s"), it picks the
// coarsest one or two units that keep the value readable ("1h", "1m 4s").
export function formatElapsedMs(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  if (abs < 1_000) return `${sign}${Math.round(abs)}ms`;

  const totalSeconds = Math.floor(abs / 1_000);
  if (totalSeconds < 60) return `${sign}${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0 ? `${sign}${totalMinutes}m` : `${sign}${totalMinutes}m ${seconds}s`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes === 0 ? `${sign}${totalHours}h` : `${sign}${totalHours}h ${minutes}m`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${sign}${days}d` : `${sign}${days}d ${hours}h`;
}

const ZERO_TRACE_ID = "00000000000000000000000000000000";

export function isZeroId(id: string): boolean {
  return !id || id === ZERO_TRACE_ID || id === "0000000000000000";
}

export function shortId(id: string, len = 16): string {
  return id.slice(0, len);
}
