// Tone names used by the shared Pill component. Each tone maps to a fixed set
// of Tailwind color classes defined in components/common/pill.tsx. Keep this
// list small — reuse existing tones before adding new ones.
export type Tone =
  | "success"
  | "destructive"
  | "warning"
  | "primary"
  | "muted"
  | "trace"
  | "metric"
  | "log";

// traceStatusTone maps a span/trace OTel status code to a Pill tone.
export function traceStatusTone(status: string): Tone {
  switch (status) {
    case "Ok":
      return "success";
    case "Error":
      return "destructive";
    default:
      return "muted";
  }
}

// severityTone maps an OTel log severity text to a Pill tone. Unknown or
// absent severities fall back to muted so the UI stays quiet.
export function severityTone(severity: string | undefined): Tone {
  switch (severity) {
    case "INFO":
      return "primary";
    case "WARN":
      return "warning";
    case "ERROR":
    case "FATAL":
      return "destructive";
    default:
      return "muted";
  }
}
