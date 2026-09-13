import {
  isLogField,
  logTermKey,
  logComparison,
  logNumberPattern,
  type LogSearchTerm,
} from "./log-search";

export const logFilterOperators = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "matches", label: "matches wildcard" },
  { value: "not_matches", label: "does not match wildcard" },
  { value: "exists", label: "exists" },
  { value: "not_exists", label: "does not exist" },
  { value: ">", label: "greater than (>)" },
  { value: ">=", label: "at least (≥)" },
  { value: "<", label: "less than (<)" },
  { value: "<=", label: "at most (≤)" },
] as const;
export type LogFilterOperator = (typeof logFilterOperators)[number]["value"];
export type LogFilterDraft = { key: string; operator: LogFilterOperator; value: string };

export function filterDraft(term?: LogSearchTerm): LogFilterDraft {
  if (!term) return { key: "", operator: "is", value: "" };
  const key = logTermKey(term);
  const comparison = logComparison(term);
  if (comparison && term.negated) return { key, operator: "not_matches", value: term.value };
  if (comparison && !term.negated)
    return {
      key,
      operator: comparison.operator as LogFilterOperator,
      value: String(comparison.value),
    };
  if (!term.quoted && term.value === "*")
    return { key, operator: term.negated ? "not_exists" : "exists", value: "" };
  if (!term.quoted && term.value.startsWith("*") && term.value.endsWith("*"))
    return {
      key,
      operator: term.negated ? "not_contains" : "contains",
      value: term.value.slice(1, -1),
    };
  if (!term.quoted && term.value.includes("*"))
    return { key, operator: term.negated ? "not_matches" : "matches", value: term.value };
  return { key, operator: term.negated ? "is_not" : "is", value: term.value };
}

export function filterDraftError(draft: LogFilterDraft): string | null {
  if (!isLogField(draft.key.trim()) && !/^(attributes|resource)\.[^\s:"]+$/.test(draft.key.trim()))
    return "Choose a log field, attributes.key, or resource.key.";
  if (
    isLogField(draft.key.trim()) &&
    draft.key.trim() !== "severity_number" &&
    [">", ">=", "<", "<="].includes(draft.operator)
  )
    return "Numeric comparisons require a numeric field.";
  if (
    [">", ">=", "<", "<="].includes(draft.operator) &&
    (!logNumberPattern.test(draft.value) || !Number.isFinite(Number(draft.value)))
  )
    return "Enter a finite number for this operator.";
  if (
    ["contains", "not_contains", "matches", "not_matches"].includes(draft.operator) &&
    !draft.value
  )
    return "Enter a value to match.";
  return null;
}

export function draftTerm(draft: LogFilterDraft): LogSearchTerm {
  const key = draft.key.trim();
  const operator = draft.operator;
  const exists = operator === "exists" || operator === "not_exists";
  const contains = operator === "contains" || operator === "not_contains";
  const numeric = [">", ">=", "<", "<="].includes(operator);
  return {
    ...(isLogField(key) ? { field: key } : {}),
    resource: key.startsWith("resource."),
    key: key.slice(key.indexOf(".") + 1),
    value: exists
      ? "*"
      : contains
        ? `*${draft.value}*`
        : numeric
          ? `${operator}${draft.value}`
          : draft.value,
    quoted: operator === "is" || operator === "is_not",
    negated:
      operator === "is_not" ||
      operator === "not_contains" ||
      operator === "not_exists" ||
      operator === "not_matches",
  };
}
