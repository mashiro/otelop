// Unit-aware value formatter used by metric charts and detail views.
// Unit strings follow OpenTelemetry semantic conventions (UCUM subset):
// https://opentelemetry.io/docs/specs/semconv/general/metrics/#instrument-units

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function fixed(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function formatBytes(v: number): string {
  const sign = v < 0 ? "-" : "";
  let n = Math.abs(v);
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${sign}${fixed(n)} ${units[i]}`;
}

function formatSeconds(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return "0 s";
  if (abs >= 60) {
    const sign = v < 0 ? "-" : "";
    const total = abs;
    const mins = Math.floor(total / 60);
    const secs = total - mins * 60;
    return `${sign}${mins}m ${secs.toFixed(0)}s`;
  }
  if (abs >= 1) return `${fixed(v)} s`;
  if (abs >= 1e-3) return `${fixed(v * 1e3)} ms`;
  return `${fixed(v * 1e6)} μs`;
}

function formatMillis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${fixed(v / 1000)} s`;
  if (abs >= 1) return `${fixed(v)} ms`;
  return `${fixed(v * 1000)} μs`;
}

export function formatMetricValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return String(value);

  switch (unit) {
    case "By":
      return formatBytes(value);
    case "By/s":
      return `${formatBytes(value)}/s`;
    case "s":
      return formatSeconds(value);
    case "ms":
      return formatMillis(value);
    case "%":
      return `${compactFmt.format(value)}%`;
    case "":
    case "1":
      return compactFmt.format(value);
  }

  // Curly-brace units denote dimensionless annotations per OTel spec
  // (e.g. "{request}", "{token}"). Strip the braces for display.
  if (unit.startsWith("{") && unit.endsWith("}")) {
    return `${compactFmt.format(value)} ${unit.slice(1, -1)}`;
  }

  return `${compactFmt.format(value)} ${unit}`;
}
