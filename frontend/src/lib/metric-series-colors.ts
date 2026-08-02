import type { MetricFacet } from "@/lib/metric-catalog";

export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

// FNV-1a gives a small, deterministic hash for UI identity strings. Assigning
// the palette slot from the series identity instead of its position in the
// current response keeps colors stable as a time window adds, removes, or
// reorders series.
export function seriesColorIndex(identity: string): number {
  if (identity === "") return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % SERIES_COLORS.length;
}

// Resolve the whole visible set together so hash collisions probe into the
// next free palette slot. Sorting identities first makes the result independent
// of response/first-appearance order; a set of up to eight distinct series is
// therefore guaranteed to use eight distinct colors.
export function seriesColorIndexes(identities: string[]): number[] {
  const uniqueIdentities = [...new Set(identities)].sort();
  const used = new Set<number>();
  const indexByIdentity = new Map<string, number>();

  for (const identity of uniqueIdentities) {
    const preferred = seriesColorIndex(identity);
    let colorIndex = preferred;
    for (let attempt = 0; attempt < SERIES_COLORS.length; attempt++) {
      if (!used.has(colorIndex)) break;
      colorIndex = (colorIndex + 1) % SERIES_COLORS.length;
    }
    used.add(colorIndex);
    indexByIdentity.set(identity, colorIndex);
  }

  return identities.map((identity) => indexByIdentity.get(identity)!);
}

// Include the facet attributes as well as the values so visually ambiguous
// labels (for example multi-value labels joined with spaces) do not share an
// identity merely because their rendered text happens to match.
export function facetGroupColorIdentity(facet: MetricFacet, groupValues: string[]): string {
  const normalizedValues = groupValues.map((value) => (value === "" ? "(unset)" : value));
  return JSON.stringify([facet.attributes, normalizedValues]);
}

export function facetGroupColorIndexes(facet: MetricFacet, groups: string[][]): number[] {
  return seriesColorIndexes(groups.map((values) => facetGroupColorIdentity(facet, values)));
}
