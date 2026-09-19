import type { SpanData } from "@/types/telemetry";

export interface FlatSpan {
  span: SpanData;
  depth: number;
  hasChildren: boolean;
}

/** Offset of a span's pre-parsed start epoch relative to a base instant. */
export function toNsOffset(startEpochNs: bigint, baseNs: bigint): number {
  return Number(startEpochNs - baseNs);
}

function compareByStartTime(a: SpanData, b: SpanData): number {
  if (a.startEpochNs < b.startEpochNs) return -1;
  if (a.startEpochNs > b.startEpochNs) return 1;
  return 0;
}

export function buildTree(spans: SpanData[]): FlatSpan[] {
  const byId = new Map<string, SpanData>();
  const children = new Map<string, SpanData[]>();

  for (const s of spans) {
    byId.set(s.spanId, s);
    const parentId = s.parentSpanId || "";
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId)!.push(s);
  }

  const result: FlatSpan[] = [];
  function walk(parentId: string, depth: number) {
    const kids = children.get(parentId) ?? [];
    kids.sort(compareByStartTime);
    for (const s of kids) {
      const hasKids = (children.get(s.spanId)?.length ?? 0) > 0;
      result.push({ span: s, depth, hasChildren: hasKids });
      walk(s.spanId, depth + 1);
    }
  }

  const roots = spans.filter((s) => !s.parentSpanId || !byId.has(s.parentSpanId));
  roots.sort(compareByStartTime);
  for (const r of roots) {
    const hasKids = (children.get(r.spanId)?.length ?? 0) > 0;
    result.push({ span: r, depth: 0, hasChildren: hasKids });
    walk(r.spanId, 1);
  }

  return result;
}

export interface SpanFilter {
  query: string;
  errorsOnly: boolean;
}

/** Ancestors are included so a match stays reachable inside its surrounding tree. */
export function matchingSpanIds(
  spans: SpanData[],
  { query, errorsOnly }: SpanFilter,
): Set<string> | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery && !errorsOnly) return null;
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const ids = new Set<string>();
  const lowerQuery = trimmedQuery.toLowerCase();
  for (const span of spans) {
    if (errorsOnly && span.statusCode !== "Error") continue;
    if (lowerQuery && !`${span.name} ${span.serviceName}`.toLowerCase().includes(lowerQuery))
      continue;
    let current: SpanData | undefined = span;
    while (current && !ids.has(current.spanId)) {
      ids.add(current.spanId);
      current = byId.get(current.parentSpanId);
    }
  }
  return ids;
}

/** Collapse is ignored while a filter is active so matches stay reachable. */
export function visibleSpans(
  flatSpans: FlatSpan[],
  collapsed: Set<string>,
  matchingIds: Set<string> | null,
): FlatSpan[] {
  const result: FlatSpan[] = [];
  let skipDepth: number | null = null;
  for (const f of flatSpans) {
    if (matchingIds && !matchingIds.has(f.span.spanId)) continue;
    if (skipDepth !== null && f.depth > skipDepth) continue;
    skipDepth = null;
    result.push(f);
    if (!matchingIds && collapsed.has(f.span.spanId)) skipDepth = f.depth;
  }
  return result;
}
