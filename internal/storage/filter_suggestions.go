package storage

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
)

// FilterSuggestions reads the selected window independently of the current
// search, so an existing filter cannot hide the values needed to edit it.
// Empty key requests field names; otherwise return scalar values for that key.
func (s *Storage) FilterSuggestions(ctx context.Context, signal, key, input string, from, to time.Time) (items []string, err error) {
	ctx, span := startStorageSpan(ctx, "storage.FilterSuggestions")
	defer func() { endStorageSpan(span, err) }()
	fields := logFieldColumns
	scope := `SELECT l.* FROM logs l WHERE l.ts >= ? AND l.ts < ?`
	alias := "l"
	switch signal {
	case "logs":
	case "traces":
		fields = traceFieldColumns
		alias = "s"
		scope = `SELECT s.* FROM spans s JOIN trace_summaries t ON t.trace_id = s.trace_id WHERE t.start_ts >= ? AND t.start_ts < ?`
	default:
		return nil, fmt.Errorf("unsupported filter signal: %s", signal)
	}
	args := []any{duckdb.Typed(from, duckdb.TYPE_TIMESTAMP_NS), duckdb.Typed(to, duckdb.TYPE_TIMESTAMP_NS)}
	base := `WITH scoped AS (` + scope + `), scoped_resources AS (SELECT r.* FROM resources r JOIN (SELECT DISTINCT resource_hash FROM scoped) h USING (resource_hash)) `
	var query string
	if key == "" {
		// Deduplicate key lists before expanding them: common OTel schemas should
		// not produce millions of identical unnested keys.
		query = base + `SELECT DISTINCT value FROM (
   SELECT 'attributes.' || unnest(keys) AS value FROM (SELECT DISTINCT json_keys(attributes) AS keys FROM scoped)
   UNION ALL
   SELECT 'resource.' || unnest(keys) AS value FROM (SELECT DISTINCT json_keys(attributes) AS keys FROM scoped_resources)
  ) WHERE value ILIKE ? ESCAPE '\' ORDER BY value LIMIT 1000`
		args = append(args, likePattern(input))
	} else {
		column, builtin := fields[key]
		source := `scoped ` + alias + ` JOIN resources r USING (resource_hash)`
		if builtin {
			if strings.HasSuffix(key, "_id") {
				zeros := strings.Repeat("0", 16)
				if key == "trace_id" {
					zeros = strings.Repeat("0", 32)
				}
				column = "NULLIF(NULLIF(" + column + ", ''), '" + zeros + "')"
			}
			column = "CAST(" + column + " AS VARCHAR)"
		} else {
			namespace, attr, ok := strings.Cut(key, ".")
			if !ok || attr == "" || (namespace != "attributes" && namespace != "resource") {
				return nil, fmt.Errorf("unsupported filter key: %s", key)
			}
			column = alias + ".attributes"
			if namespace == "resource" {
				source = "scoped_resources r"
				column = "r.attributes"
			}
			path := "/" + strings.NewReplacer("~", "~0", "/", "~1").Replace(attr)
			column = "CASE WHEN json_type(" + column + ", ?) IN ('VARCHAR','BOOLEAN','BIGINT','UBIGINT','DOUBLE') THEN json_extract_string(" + column + ", ?) END"
			args = append(args, path, path)
		}
		query = base + `SELECT DISTINCT value FROM (SELECT ` + column + ` AS value FROM ` + source + `) WHERE value IS NOT NULL AND value ILIKE ? ESCAPE '\' ORDER BY value LIMIT 20`
		args = append(args, likePattern(input))
	}
	rows, err := s.DB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage: suggest filters: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items = make([]string, 0)
	for rows.Next() {
		var value string
		if err = rows.Scan(&value); err != nil {
			return nil, err
		}
		items = append(items, value)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if key == "" {
		for field := range fields {
			if strings.Contains(strings.ToLower(field), strings.ToLower(input)) {
				items = append(items, field)
			}
		}
		slices.Sort(items)
		items = slices.Compact(items)
		if len(items) > 1000 {
			items = items[:1000]
		}
	}
	return items, nil
}
