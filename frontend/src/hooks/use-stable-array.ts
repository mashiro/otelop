import { useRef } from "react";

// Returns the previous array reference when the new array is content-equal,
// so a React.memo'd consumer downstream (MetricChart, MetricSummary,
// DataPointsTable — see metric-detail.tsx) can skip re-rendering on a
// WebSocket delivery that doesn't actually change what's visible. A full
// deep-equal would defeat the point of avoiding the recompute; the telemetry
// this wraps (windowed metric points, aggregate series) only ever changes at
// its edges, so length plus the first/last element's key is enough to catch
// "nothing changed" without walking the whole array.
export function useStableArray<T>(array: T[], key: (item: T) => string | number): T[] {
  const ref = useRef(array);
  if (ref.current !== array && !isSameContent(ref.current, array, key)) {
    ref.current = array;
  }
  return ref.current;
}

function isSameContent<T>(a: T[], b: T[], key: (item: T) => string | number): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return key(a[0]!) === key(b[0]!) && key(a[a.length - 1]!) === key(b[b.length - 1]!);
}
