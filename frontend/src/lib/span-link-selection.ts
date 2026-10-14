export interface SpanLinkIdentity {
  sourceTraceId: string;
  sourceSpanId: string;
  ordinal: number;
}

export function parseSpanLink(value: unknown): SpanLinkIdentity | undefined {
  if (typeof value !== "string") return;
  const match = /^([^/]+)\/([^/]+)\/(0|[1-9]\d*)$/.exec(value);
  if (!match || Number(match[3]) > 2147483647) return;
  return { sourceTraceId: match[1], sourceSpanId: match[2], ordinal: Number(match[3]) };
}

export function spanLinkSelection(link: SpanLinkIdentity): string {
  return `${link.sourceTraceId}/${link.sourceSpanId}/${link.ordinal}`;
}
