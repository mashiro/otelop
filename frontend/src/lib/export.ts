// Store view models (TraceData/LogData/DataPoint — see types/telemetry.ts)
// carry derived bigint epoch fields alongside their wire ISO-string
// timestamps; JSON.stringify throws on a bigint with no replacer. Both JSON
// boundaries below copy/export whatever record a caller hands them
// (trace-detail.tsx's CopyJsonButton/download, log-list.tsx's
// CopyJsonButton), so this replacer — not per-caller field stripping — is
// the one place that makes any record JSON-safe. Deliberately not a global
// BigInt.prototype.toJSON patch, which would silently change how bigints
// serialize everywhere in the app instead of just at this export boundary.
function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function stringifyJson(data: unknown): string {
  return JSON.stringify(data, bigintSafeReplacer, 2);
}

export async function copyJsonToClipboard(data: unknown): Promise<boolean> {
  try {
    const json = stringifyJson(data);
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}

export function downloadJson(data: unknown, filename: string): void {
  const json = stringifyJson(data);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
