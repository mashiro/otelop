import type { LogData } from "@/types/telemetry";

export const logFields = {
  trace_id: "traceId",
  span_id: "spanId",
  service_name: "serviceName",
  severity_text: "severityText",
  severity_number: "severityNumber",
  body: "body",
} as const;
export type LogField = keyof typeof logFields;
export function isLogField(key: string): key is LogField {
  return Object.hasOwn(logFields, key);
}
export function logTermValue(log: LogData, term: LogSearchTerm): unknown {
  if (term.field && isLogField(term.field)) {
    const value = log[logFields[term.field]];
    if (
      (term.field === "trace_id" || term.field === "span_id") &&
      (!value || /^0+$/.test(String(value)))
    )
      return undefined;
    return value;
  }
  const attrs = term.resource ? log.resource : log.attributes;
  return Object.hasOwn(attrs, term.key) ? attrs[term.key] : undefined;
}
export function logTermKey(term: LogSearchTerm): string {
  return term.field ?? `${term.resource ? "resource" : "attributes"}.${term.key}`;
}

export type LogSearchTerm = {
  field?: string;
  resource: boolean;
  key: string;
  value: string;
  quoted: boolean;
  negated: boolean;
};

// Keep aligned with internal/storage/log_search.go: dots are literal OTel keys.
export function parseLogSearch(
  search: string,
  fields: readonly string[] = Object.keys(logFields),
): { plain: string; terms: LogSearchTerm[] } {
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
    if (colon < 0 || (!resource && !field.startsWith("attributes.") && !fields.includes(field))) {
      text.push(token);
      continue;
    }
    const key = fields.includes(field) ? field : field.slice(field.indexOf(".") + 1);
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
    terms.push({
      resource,
      key,
      value,
      quoted,
      negated,
      ...(fields.includes(field) ? { field } : {}),
    });
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
  return `${term.negated ? "-" : ""}${logTermKey(term)}:${term.quoted ? JSON.stringify(term.value) : /[\s"]/.test(term.value) ? `~${JSON.stringify(term.value)}` : term.value}`;
}

export function createLogSearchMatcher(search: string): (log: LogData) => boolean {
  const { plain, terms } = parseLogSearch(search);
  const q = plain.toLowerCase();
  const filters = terms.map((term) => createTermMatcher(term, term.field === "severity_number"));
  return (log) =>
    (!q ||
      [log.body, log.serviceName ?? "", log.severityText ?? "", log.traceId].some((value) =>
        value.toLowerCase().includes(q),
      ) ||
      JSON.stringify(log.attributes).toLowerCase().includes(q) ||
      JSON.stringify(log.resource).toLowerCase().includes(q)) &&
    filters.every((filter, index) => filter(logTermValue(log, terms[index])));
}

export function createTermMatcher(
  term: LogSearchTerm,
  numericField = false,
): (value: unknown) => boolean {
  const comparison = logComparison(term);
  const pattern = (term.quoted ? [term.value] : term.value.split("*"))
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]*");
  const regex = new RegExp(`^(?:${pattern})$(?![\\s\\S])`, "i");
  const matches = (value: unknown) => {
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
    if (numericField && logNumberPattern.test(term.value) && Number.isFinite(Number(term.value)))
      return typeof value === "number" && value === Number(term.value);
    return (
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      regex.test(String(value))
    );
  };
  return (value) => (term.negated ? !matches(value) : matches(value));
}
