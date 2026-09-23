import type { SpanStatus } from "@/types/telemetry";

// Reuse existing semantic tones before adding new ones.
export type Tone =
  | "debug"
  | "info"
  | "fatal"
  | "success"
  | "destructive"
  | "warning"
  | "primary"
  | "muted"
  | "trace"
  | "metric"
  | "log";

// traceStatusTone maps a span/trace OTel status code to a badge tone. The
// switch is exhaustive over SpanStatus so adding a new value triggers a
// type error here until the mapping is updated.
export function traceStatusTone(status: SpanStatus): Tone {
  switch (status) {
    case "Ok":
      return "success";
    case "Error":
      return "destructive";
    case "Unset":
      return "muted";
  }
}

// Unknown or absent severity text falls back to the OTel severity number.
// Records without a valid text or number remain muted.
// Severity text is free-form in OTel, and sources like the collector's
// filelog parsers or Python logging emit "info" / "WARNING" / "CRITICAL",
// so match case-insensitively and accept those common aliases.
export function severityTone(severity: string | undefined, severityNumber?: number): Tone {
  switch (
    severity
      ?.trim()
      .toUpperCase()
      .replace(/^(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)[2-4]$/, "$1")
  ) {
    case "TRACE":
      return "muted";
    case "DEBUG":
      return "debug";
    case "INFO":
      return "info";
    case "WARN":
    case "WARNING":
      return "warning";
    case "ERROR":
      return "destructive";
    case "FATAL":
    case "CRITICAL":
      return "fatal";
    default:
      if (
        severityNumber != null &&
        Number.isInteger(severityNumber) &&
        severityNumber >= 1 &&
        severityNumber <= 24
      ) {
        const tones: Tone[] = ["muted", "debug", "info", "warning", "destructive", "fatal"];
        return tones[Math.floor((severityNumber - 1) / 4)]!;
      }
      return "muted";
  }
}
