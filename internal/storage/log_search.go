package storage

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
)

type logSearchTerm struct {
	field    string
	resource bool
	key      string
	value    string
	quoted   bool
	negated  bool
}

var logFieldColumns = map[string]string{
	"trace_id": "l.trace_id", "span_id": "l.span_id", "service_name": "r.service_name",
	"severity_text": "l.severity_text", "severity_number": "l.severity_number", "body": "l.body",
}

// Keep this grammar aligned with frontend/src/lib/log-search.ts for live logs.
// Only explicit namespaces introduce field filters, preserving colon-containing
// free text (URLs, timestamps, etc.). Dots in OTel keys are literal.
func parseLogSearch(search string) (string, []logSearchTerm) {
	var tokens []string
	start, quoted, escaped := 0, false, false
	for i, c := range search {
		if escaped {
			escaped = false
			continue
		}
		if quoted && c == '\\' {
			escaped = true
			continue
		}
		if c == '"' {
			quoted = !quoted
		}
		if !quoted && strings.ContainsRune(" \t\r\n", c) {
			if start < i {
				tokens = append(tokens, search[start:i])
			}
			start = i + 1
		}
	}
	if quoted {
		return search, nil
	}
	if start < len(search) {
		tokens = append(tokens, search[start:])
	}
	var terms []logSearchTerm
	var text []string
	for _, token := range tokens {
		field, value, ok := strings.Cut(token, ":")
		negated := strings.HasPrefix(field, "-")
		field = strings.TrimPrefix(field, "-")
		resource := strings.HasPrefix(field, "resource.")
		_, builtin := logFieldColumns[field]
		if !ok || (!resource && !strings.HasPrefix(field, "attributes.") && !builtin) {
			text = append(text, token)
			continue
		}
		_, key, _ := strings.Cut(field, ".")
		if builtin {
			key = field
		}
		if key == "" || value == "" {
			return search, nil
		}
		term := logSearchTerm{resource: resource, key: key, value: value, negated: negated}
		if builtin {
			term.field = field
		}
		wildcardString := strings.HasPrefix(value, `~"`)
		if strings.HasPrefix(value, `"`) || wildcardString {
			if wildcardString {
				value = value[1:]
			}
			if err := json.Unmarshal([]byte(value), &term.value); err != nil {
				return search, nil
			}
			term.quoted = !wildcardString
		}
		terms = append(terms, term)
	}
	if len(terms) == 0 {
		return search, nil
	}
	var plain []string
	for _, token := range text {
		if token != "AND" {
			plain = append(plain, token)
		}
	}
	return strings.Join(plain, " "), terms
}

var logComparisonPattern = regexp.MustCompile(`^(>=|<=|>|<)(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$`)

func logSearchSQL(search string) (string, []any) {
	plain, terms := parseLogSearch(search)
	pattern := likePattern(plain)
	predicate := searchPredicate
	args := []any{pattern, pattern, pattern, pattern, pattern, pattern}
	for _, term := range terms {
		clause, values := logAttributeSQL(term)
		if term.negated {
			clause = "NOT COALESCE((" + clause + "), FALSE)"
		}
		predicate += " AND (" + clause + ")"
		args = append(args, values...)
	}
	return predicate, args
}

func logAttributeSQL(term logSearchTerm) (string, []any) {
	if term.field != "" {
		return logFieldSQL(term)
	}
	column := "l.attributes"
	if term.resource {
		column = "r.attributes"
	}
	// JSON Pointer keeps dots and SQL/JSONPath metacharacters literal.
	path := "/" + strings.NewReplacer("~", "~0", "/", "~1").Replace(term.key)
	if !term.quoted {
		if term.value == "*" {
			return "json_type(" + column + ", ?) IS NOT NULL AND json_type(" + column + ", ?) <> 'NULL'", []any{path, path}
		}
		if match := logComparisonPattern.FindStringSubmatch(term.value); match != nil {
			value, err := strconv.ParseFloat(match[2], 64)
			if err == nil && !math.IsInf(value, 0) && !math.IsNaN(value) {
				return "json_type(" + column + ", ?) IN ('BIGINT', 'UBIGINT', 'DOUBLE') AND TRY_CAST(json_extract_string(" + column + ", ?) AS DOUBLE) " + match[1] + " ?", []any{path, path, value}
			}
		}
	}
	value := likeEscaper.Replace(term.value)
	if !term.quoted {
		value = strings.ReplaceAll(value, "*", "%")
	}
	return "json_type(" + column + ", ?) IN ('VARCHAR', 'BOOLEAN', 'BIGINT', 'UBIGINT', 'DOUBLE') AND json_extract_string(" + column + ", ?) ILIKE ? ESCAPE '\\'", []any{path, path, value}
}

// Column names come exclusively from the allowlist, never from query text.
func logFieldSQL(term logSearchTerm) (string, []any) {
	column := logFieldColumns[term.field]
	if term.field == "trace_id" || term.field == "span_id" {
		zeros := strings.Repeat("0", 32)
		if term.field == "span_id" {
			zeros = strings.Repeat("0", 16)
		}
		column = "NULLIF(NULLIF(" + column + ", ''), '" + zeros + "')"
	}
	if !term.quoted {
		if term.value == "*" {
			return column + " IS NOT NULL", nil
		}
		if match := logComparisonPattern.FindStringSubmatch(term.value); match != nil {
			value, err := strconv.ParseFloat(match[2], 64)
			if err == nil && !math.IsInf(value, 0) && !math.IsNaN(value) {
				if term.field != "severity_number" {
					return "FALSE", nil
				}
				return column + " " + match[1] + " ?", []any{value}
			}
		}
	}
	value := likeEscaper.Replace(term.value)
	if !term.quoted {
		value = strings.ReplaceAll(value, "*", "%")
	}
	return "CAST(" + column + " AS VARCHAR) ILIKE ? ESCAPE '\\'", []any{value}
}
