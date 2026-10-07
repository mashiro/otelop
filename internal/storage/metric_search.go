package storage

var metricFieldColumns = map[string]string{
	"name": "s.metric_name", "service_name": "s.service_name",
	"type": "s.metric_type", "unit": "s.unit", "description": "s.description",
}

// A metric matches when all conditions match one series. The list still
// returns the whole metric group so opening it preserves its complete history.
func metricSearchSQL(search string) (string, []any) {
	plain, terms := parseSignalSearch(search, metricFieldColumns)
	predicate := "s.metric_name ILIKE ? ESCAPE '\\'"
	args := []any{likePattern(plain)}
	for _, term := range terms {
		clause, values := signalAttributeSQL(term, "s.attributes", metricFieldColumns, nil)
		if term.negated {
			clause = "NOT COALESCE((" + clause + "), FALSE)"
		}
		predicate += " AND (" + clause + ")"
		args = append(args, values...)
	}
	return predicate, args
}
