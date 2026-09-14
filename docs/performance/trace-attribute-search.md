# Trace attribute search

## Semantics

Traces uses the Logs Key / Operator / Value controls, including edit, disable,
remove, and URL restoration (`q`, repeated `filter` / `disabled_filter`). The
selected live or fixed time window is retained during search and pagination.
The window applies to the trace's earliest retained span start, with inclusive
`from` and exclusive `to`, preserving nanoseconds.

Each trace qualifies when one retained span satisfies **all** predicates. Child
spans participate; predicates on different spans cannot combine into a match.
Negation is also per span: `-attributes.http.method:GET` means that a qualifying
span does not have that value, including when the attribute is absent. It does
not mean that GET is absent from the entire trace.

Fields: `trace_id`, `span_id`, `parent_span_id`, `service_name`, `name`, `kind`,
`status_code`, `status_message`, `duration_ms`, `attributes.KEY`, `resource.KEY`.
Attribute keys containing dots are literal. Numeric comparisons accept numeric
attributes and `duration_ms`; a numeric-looking string is not a number.
Quoted values compare case-insensitively for equality, while unquoted `*`
provides wildcard matching. An unquoted `*` alone tests non-null existence.

Free text is a case-insensitive literal substring search over trace/span IDs,
span name/status/message, service name, and serialized span attributes,
resource attributes and events. `%`, `_`, and backslash are escaped for ILIKE.

Conceptually, the attribute query is:

```sql
SELECT t.* FROM trace_summaries t
WHERE t.start_ts >= ? AND t.start_ts < ?
  AND EXISTS (
    SELECT 1 FROM spans s JOIN resources r USING (resource_hash)
    WHERE s.trace_id = t.trace_id
      AND json_type(s.attributes, ?) IN ('BIGINT', 'UBIGINT', 'DOUBLE')
      AND TRY_CAST(json_extract_string(s.attributes, ?) AS DOUBLE) >= ?
      AND json_extract_string(r.attributes, ?) ILIKE ? ESCAPE '\'
  )
-- Existing (start_ts, first_seen, trace_id) cursor, ORDER BY and LIMIT follow.
```

Keys and values bind as parameters. SQL identifiers and operators come from
allowlists. Ordinary browsing retains its separate summary-only query and
never scans attributes.

Live updates are collected into batches for `matchingTraceIds`, which uses the
same predicate, selected window and a bounded list of IDs. It returns only IDs,
without loading all span details or resetting list pagination. Updates are
coalesced for 500 ms, versioned per ID to reject stale responses, and retried
with backoff after errors. Requests contain at most 1000 IDs.

Metrics intentionally uses only metric-name substring search, with `q` in its
URL. Service, type and description are no longer searched. Metric detail time
windows remain independent of the metric-name catalog search.

## Local measurements (2026-09-14)

Command:

```sh
mise exec -- go test ./internal/storage -run '^$' \
  -bench '^BenchmarkTraceSearch$' -benchtime=10x -count=1
```

Apple M3, darwin/arm64, local file-backed temporary DuckDB. No user data was
used. Synthetic data spans seven days, with ten spans per trace, twenty
attributes per span, unique request IDs, and a nested JSON command. The
1,000,000-span fixture contains 100,000 traces and occupies 193.8 MiB after
checkpoint. This size is specific to the fixture's compression and does not
predict production storage size.

Queries cover the entire seven days and return up to 100 trace summaries.
Fixture creation is excluded, and each case is warmed once before ten timed
iterations. p95 from ten samples is the slowest sample and is only indicative.
The isolated verification server was also running for light manual UI checks.
These are local SQL and result-decoding timings, not end-to-end UI latency
or a controlled load-test guarantee.

| Search | 100,000 spans p50 / p95 | 1,000,000 spans p50 / p95 |
|---|---:|---:|
| Browse | 1.3 / 1.4 ms | 3.9 / 4.1 ms |
| Free text matching span name | 31.6 / 35.5 ms | 100.3 / 108.2 ms |
| Free text matching JSON (`diff`) | 83.2 / 86.3 ms | 227.3 / 255.2 ms |
| Numeric attribute + resource | 65.6 / 67.2 ms | 241.8 / 259.4 ms |
| Unique attribute value | 56.2 / 65.3 ms | 201.3 / 228.9 ms |
| Free text, no match | 158.6 / 236.0 ms | 413.8 / 510.1 ms |

Rechecking 100 live IDs with a numeric attribute predicate averaged 3.3 ms at
100,000 spans and 5.2 ms at 1,000,000 spans, excluding the 500 ms coalescing
interval and network latency. Larger or less compressible attributes, longer
traces, concurrent ingestion and cold storage can materially change results.

## DB-backed filter suggestions

Logs and Traces query `filterSuggestions` for keys and scalar values. Candidates
come from the selected time window, independent of list pagination, loaded
span details and active search conditions. Trace candidates include every span
of traces whose start time is in the window. Standard fields remain available
even if the window contains no data.

An omitted key returns standard fields plus top-level `attributes.*` and
`resource.*` keys. A key returns distinct string/number/boolean values; objects,
arrays and JSON null do not produce value candidates. Dotted attribute names
remain literal, using bound JSON Pointers. Invalid signals/fields are rejected.
Input is a case-insensitive literal substring (including literal `%` and `_`).
Keys have a hard limit of 1,000 results. Values are sorted and
limited to 20 **after DB-side input filtering**, so entering more text can find
values outside the initial 20 candidates. Value suggestions are not paginated.

The frontend debounces input by 200 ms and cancels superseded requests on input,
key, time-window changes and unmount. Old responses cannot replace the current
candidate list. A failed request shows an error while leaving manual entry
available. Key-list arrays are deduplicated before unnesting; resource candidates
query distinct resources used in the window rather than expanding every row.

The following measurements were taken with the earlier 100-candidate limit.
Measured locally on the same Apple M3, with 1,000,000 synthetic logs and
1,000,000 synthetic spans (100,000 traces). Ten iterations, arithmetic mean,
fixture creation excluded. The lightweight isolated UI verification server was
also running. These exclude debounce/network/rendering and are not load-test
or cold-cache guarantees.

| Candidate query | Logs | Traces |
|---|---:|---:|
| Keys, empty input | 255.6 ms | 228.4 ms |
| Keys containing `http` | 307.7 ms | — |
| High-cardinality request ID values, empty input | 571.5 ms | 517.8 ms |
| Request ID values with selective input | 388.7 ms | 356.4 ms |
| Resource service-name values | 3.1 ms | — |

```sh
mise exec -- go test ./internal/storage -run '^$' \
  -bench 'BenchmarkLogFilterSuggestions|BenchmarkTraceSearch/spans_1000000/suggest' \
  -benchtime=10x -count=1
```
