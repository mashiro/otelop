import type { LogData } from "@/types/telemetry";

export type LogSearchTerm = {
  resource: boolean;
  key: string;
  value: string;
  quoted: boolean;
  negated: boolean;
};

// Keep aligned with internal/storage/log_search.go: dots are literal OTel keys.
export function parseLogSearch(search: string): { plain: string; terms: LogSearchTerm[] } {
  const fallback = { plain: search, terms: [] };
  const tokens: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < search.length; i++) {
    const c = search[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (!quoted && " \t\r\n".includes(c)) {
      if (start < i) tokens.push(search.slice(start, i));
      start = i + 1;
    }
  }
  if (quoted) return fallback;
  if (start < search.length) tokens.push(search.slice(start));
  const terms: LogSearchTerm[] = [];
  const text: string[] = [];
  for (const token of tokens) {
    const colon = token.indexOf(":");
    const negated = token.startsWith("-");
    const field = token.slice(negated ? 1 : 0, colon);
    const resource = field.startsWith("resource.");
    if (colon < 0 || (!resource && !field.startsWith("attributes."))) {
      text.push(token);
      continue;
    }
    const key = field.slice(field.indexOf(".") + 1);
    let value = token.slice(colon + 1);
    if (!key || !value) return fallback;
    const quoted = value.startsWith('"');
    const wildcardString = value.startsWith('~"');
    if (quoted || wildcardString) {
      try {
        value = JSON.parse(wildcardString ? value.slice(1) : value) as string;
      } catch {
        return fallback;
      }
    }
    terms.push({ resource, key, value, quoted, negated });
  }
  if (!terms.length) return fallback;
  return { plain: text.filter((token) => token !== "AND").join(" "), terms };
}

export const logNumberPattern = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function logComparison(term: LogSearchTerm): { operator: string; value: number } | null {
  if (term.quoted) return null;
  const match = /^(>=|<=|>|<)(.+)$/.exec(term.value);
  if (!match || !logNumberPattern.test(match[2]) || !Number.isFinite(Number(match[2]))) return null;
  return { operator: match[1], value: Number(match[2]) };
}

export function serializeLogTerm(term: LogSearchTerm): string {
  return `${term.negated ? "-" : ""}${term.resource ? "resource" : "attributes"}.${term.key}:${term.quoted ? JSON.stringify(term.value) : /[\s"]/.test(term.value) ? `~${JSON.stringify(term.value)}` : term.value}`;
}

export function createLogSearchMatcher(search: string): (log: LogData) => boolean {
  const { plain, terms } = parseLogSearch(search);
  const q = plain.toLowerCase();
  const filters = terms.map((term) => {
    const comparison = logComparison(term);
    const pattern = (term.quoted ? [term.value] : term.value.split("*"))
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\\S]*");
    const regex = new RegExp(`^(?:${pattern})$(?![\\s\\S])`, "i");
    const matches = (log: LogData) => {
      const attrs = term.resource ? log.resource : log.attributes;
      const value = Object.hasOwn(attrs, term.key) ? attrs[term.key] : undefined;
      if (value == null) return false;
      if (comparison) {
        if (typeof value !== "number") return false;
        switch (comparison.operator) {
          case ">":
            return value > comparison.value;
          case ">=":
            return value >= comparison.value;
          case "<":
            return value < comparison.value;
          case "<=":
            return value <= comparison.value;
        }
      }
      if (!term.quoted && term.value === "*") return true;
      return (
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
        regex.test(String(value))
      );
    };
    return (log: LogData) => (term.negated ? !matches(log) : matches(log));
  });
  return (log) =>
    (!q ||
      [log.body, log.serviceName ?? "", log.severityText ?? "", log.traceId].some((value) =>
        value.toLowerCase().includes(q),
      ) ||
      JSON.stringify(log.attributes).toLowerCase().includes(q) ||
      JSON.stringify(log.resource).toLowerCase().includes(q)) &&
    filters.every((filter) => filter(log));
}
