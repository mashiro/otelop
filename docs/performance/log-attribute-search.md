# Log attribute search measurements

Measured on 2026-09-14 against the attribute-search working tree, using the actual
`Storage.LogsPage` path (SQL execution, scanning, and JSON decoding of returned
records). No search implementation changes were made during measurement.

## Environment and method

- Apple M3, 8 logical CPUs, 24 GiB RAM; DuckDB v1.5.5, 8 threads.
- File-backed DuckDB, all retained logs, first page of 100 records (SQL fetches 101).
- One warm-up, then 30 serial requests per case. p50 is the median; p95 is the
  nearest-rank 95th percentile. These are warm-cache measurements, not cold disk
  reads or concurrent-ingestion throughput measurements.
- HTTP/GraphQL transport, browser rendering, and WebSocket filtering are excluded.
- The user's stopped database was copied to a private temporary directory. The
  original was not opened or modified. Attribute values and log bodies are not
  recorded in this report or benchmark output.

## Datasets

The user clarified that the application had not been exercised when the source
snapshot was taken. Its log count, growth rate, payload distribution, and search
latencies must not be used as a normal-use baseline or as evidence of adequate
production/development performance. The snapshot is only a source fixture.


| Dataset | Log rows | Mean attribute JSON | Mean body | Resources |
| --- | ---: | ---: | ---: | ---: |
| Idle-snapshot records repeated to scale | 100,000 / 1,000,000 | approximately 939 bytes | 0 bytes | 5 |
| Synthetic | 100,000 / 1,000,000 | 579 bytes | 224 bytes | 100 |

For fixture provenance only: the idle snapshot contained 2,457 logs. The whole
database was approximately 578 MiB, including traces and metrics. Neither figure
is used to estimate normal workload size or to compare it with the load tests.
The initial metadata reported 918 Unicode characters per attribute JSON; a final
UTF-8 byte-count check corrected the size to 939 bytes. This metadata correction
does not change the dataset or timed query path.

The repeated-snapshot dataset preserves the idle fixture's attribute/body distributions, generates new
record UUIDs, and sorts by timestamp. It repeats the original values/timestamps,
so its compression and value cardinality are not representative of a million
independent real-world logs. Repeating an idle fixture does not make its workload
representative of active application use. The separate synthetic dataset has 20–21 attributes,
unique request IDs, varying session/user IDs and paths, and ordered timestamps
spread across seven days. Synthetic persisted DB sizes were 27.5 MiB for 100,000
logs and 269.8 MiB for 1,000,000 logs.

## Idle-snapshot records repeated to scale

Values below are p50 / p95, in milliseconds. All requests search the full
history and return at most 100 records.

| Query | 100,000 logs | 1,000,000 logs, first run | 1,000,000 logs, independent repeat |
| --- | ---: | ---: | ---: |
| Browse | 20.80 / 22.59 | 13.38 / 15.24 | — |
| Attribute 1, common value | 84.18 / 89.14 | 244.8 / 255.6 | 223.4 / 245.1 |
| Attribute 1, no match | 79.83 / 84.90 | 255.0 / 277.5 | — |
| Attribute 2, common value | — | 263.8 / 282.9 | — |
| Attribute 3, common value | — | 418.0 / 472.5 | 231.5 / 250.0 |
| Attribute 3, no match | — | 525.6 / 632.6 | — |
| Two attribute equalities with AND | 136.3 / 138.0 | 853.1 / 911.7 | 415.7 / 446.9 |

The independent repeat recreated the scaled DB and ran only the three indicated
cases, again with 30 requests each. The first run had 12 cases. The sizable
run-to-run difference is retained here rather than selecting the fastest result.
Other machine activity and thermal state were not controlled. This experiment
does not identify why the longer run became slower; these numbers are observed
latencies, not a guaranteed latency bound. Browse also benefits from DuckDB's
parallel execution and pruning, so its time need not grow monotonically with size.

## SQL execution profile

A separate synthetic 1,000,000-row `EXPLAIN ANALYZE` run for attribute status 500
reported 177 ms total SQL wall time. The plan processed all 1,000,000 log rows:

| Stage | Rows | Reported operator time |
| --- | ---: | ---: |
| Sequential log scan | 1,000,000 | 0.37 s |
| MARK join implementing `json_type(...) IN (...)` | 1,000,000 | 0.43 s |
| JSON extraction and ILIKE filter | 10,000 emitted | 0.53 s |
| Resource join / TOP_N (101) | 10,000 / 101 | under displayed 0.01 s resolution |

Operator times accumulate parallel work and must **not** be added to infer
wall-clock latency. The no-hit plan likewise scans 1,000,000 rows, emits zero,
and spends its work on JSON type/value filtering. There is no attribute index
lookup in either plan.

- CPU: JSON evaluation and filtering dominate the reported operator work.
- Storage: scanning/decompression remains part of the cost. Warm-cache runs do
  not establish physical-disk throughput or cold-start latency.
- Network: none in this benchmark. HTTP, response serialization, and browser work
  would add to these measured storage-layer times.

## Assessment

Assessment is based on the explicitly sized load-test fixtures, excluding the
unscaled idle snapshot. At 100,000 repeated-snapshot records, the measured AND
case takes about 136 ms. At 1,000,000 it takes about 416–853 ms median and
447–912 ms p95 across two runs. The independent synthetic million-row dataset
occupies approximately 270 MiB and its three-condition AND takes about 243 ms
median / 279 ms p95. These results describe specific datasets and queries;
they do not establish the application's normal log volume.

No user latency target or expected active-workload volume was specified. There
is therefore no basis to declare either that optimization is required or that
normal-use performance is sufficient. A latency budget should be assessed
against expected active-workload sizes and payload distributions. If those
requirements exceed the measured performance, reduce per-row JSON processing
and remeasure before considering a separate attribute-search structure.
Ten million rows, true cold-cache runs, concurrent ingest, deep pagination,
and HTTP/UI end-to-end latency were not measured.

## Synthetic dataset

Values below are p50 / p95, in milliseconds.

| Query | 100,000 logs | 1,000,000 logs |
| --- | ---: | ---: |
| Browse | 48.68 / 49.74 | 78.15 / 87.96 |
| Body `status=500` (1% matches) | 81.42 / 84.92 | 182.3 / 192.3 |
| Attribute status 500 (same 1% matches) | 59.14 / 61.58 | 173.2 / 185.4 |
| Status AND method AND resource environment | 79.24 / 80.25 | 242.6 / 278.7 |
| Resource service equality | 11.24 / 11.64 | 35.39 / 39.82 |
| Attribute path wildcard (all match) | 96.73 / 131.8 | 234.0 / 260.4 |
| Unique request ID near oldest timestamp | 58.08 / 59.25 | 185.4 / 206.0 |
| Attribute wildcard, no match | 59.42 / 60.60 | 189.9 / 210.1 |
| Body, no match | 75.96 / 77.00 | 199.7 / 239.4 |
| Attribute existence (1% match) | 35.03 / 35.53 | 106.8 / 117.7 |

The resource filter targets a small dimension table; it is not evidence that
arbitrary per-log attribute filters have similar performance. The absent/unique
attribute cases still process the retained history despite a 100-record page limit.

## Reproduction

```sh
mise exec -- go test ./internal/storage -run '^$' \
  -bench '^BenchmarkLogsPageSearch$' -benchtime=30x -count=1 -timeout=15m -v
```

Select dataset sizes with `OTELOP_BENCH_LOG_ROWS=100000,1000000`. For optional
synthetic-only SQL plans, set `OTELOP_BENCH_LOG_EXPLAIN_DIR` to an existing directory.
Fixture generation is excluded from query timings; temporary synthetic databases
are removed automatically.

For an explicitly authorized, stopped database copy:

```sh
OTELOP_BENCH_LOG_COPY=/private/tmp/private-bench/user-copy.duckdb \
  mise exec -- go test ./internal/storage -run '^$' \
  -bench '^BenchmarkLogsPageSearchUserCopy$' -benchtime=30x -count=1 -timeout=15m -v
```

Add `OTELOP_BENCH_LOG_COPY_ROWS=1000000` to measure a repeated-data scale scenario.
The supplied copy opens read-only. The scaled database is built separately in a
Go test temporary directory and removed automatically. Do not commit DB copies.

## Plain-text JSON search (2026-09-14)

Plain text now also searches serialized attributes and resource JSON. These
measurements use the synthetic 1,000,000-row workload, the full seven-day range,
and a 100-record page. They do not represent the user's workload or UI latency.
Apple M3, 8 threads, 10 timed queries after warm-up; fixture creation excluded.
The reported post-change run was performed after tests and verification servers stopped.

| Query | Before p50 / p95 (ms) | With JSON p50 / p95 (ms) |
| --- | ---: | ---: |
| Body `status=500` | 184.7 / 208.1 | 571.5 / 638.6 |
| No hit `not-present` | 175.8 / 182.1 | 592.8 / 617.7 |
| Attribute value `handleOrder` | Not supported | 544.6 / 555.7 |
| Resource value `production` | Not supported | 627.0 / 798.3 |

Full-range scans cost about 3.1–3.4 times the median of the two comparable
queries. Time-window and cursor predicates remain in place. These results do
not establish performance for narrower windows, cold caches, or other JSON sizes.
Reproduce with OTELOP_BENCH_LOG_ROWS=1000000 and BenchmarkLogsPageSearch,
selecting body_error, body_nohit, json_attribute, and json_resource with
-benchtime=10x -count=1.
