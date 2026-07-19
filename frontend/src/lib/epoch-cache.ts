import { Temporal } from "temporal-polyfill";

// OTel timestamps are nanosecond-precision ISO strings (see CLAUDE.md's
// Timestamps convention); Temporal.Instant.from parses them once per record
// and this WeakMap remembers the epoch nanoseconds by object identity, so
// repeated sorts/range-filters over the same live buffer
// (stores/telemetry.ts's newestTraceStartFirst/mergeTrace,
// stores/filters.ts's rangeFiltered*Atom, lib/chart-time-range.ts's
// filterDataPointsInRange) don't re-parse a timestamp that hasn't changed —
// every WS message used to trigger a full re-sort of up to logCap/traceCap
// records, each re-parsing its timestamp from scratch. A record that IS
// updated is always a fresh object (every mutation in stores/telemetry.ts
// spreads into a new object rather than mutating in place), so the cache
// naturally invalidates itself instead of ever returning a stale value.
const epochCache = new WeakMap<object, bigint>();

export function cachedEpochNanos(item: object, timestamp: string): bigint {
  const cached = epochCache.get(item);
  if (cached !== undefined) return cached;
  const ns = Temporal.Instant.from(timestamp).epochNanoseconds;
  epochCache.set(item, ns);
  return ns;
}
