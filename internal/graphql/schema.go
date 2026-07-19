// Package graphql exposes otelop's DuckDB-backed telemetry store to callers via a
// GraphQL schema. It is the integration surface for AI-driven investigation —
// field selection lets callers take exactly the data they want (and nothing
// more), and the Trace.logs field implements the standard trace↔log
// correlation join in one round-trip.
//
// graph-gophers/graphql-go matches GraphQL field names to Go method names
// case-insensitively (ignoring underscores), so idiomatic Go identifiers like
// TraceID/SpanID resolve the `traceId`/`spanId` schema fields directly — no
// rename is needed on the Go side when the schema uses camelCase with a
// lowercase "d".
package graphql

import (
	_ "embed"
	"time"

	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/storage"
)

//go:embed schema.graphql
var schemaSource string

// RuntimeInfo is captured once at startup and passed to the resolver so the
// `status` query can report process-level state without reaching into
// package globals.
type RuntimeInfo struct {
	Version       string
	StartedAt     time.Time
	HTTPAddr      string
	OTLPGRPCAddr  string
	OTLPHTTPAddr  string
	ProxyURL      string
	ProxyProtocol string
	Debug         bool
	// LogLevel is the raw configured log level (e.g. "warn"), surfaced as-is
	// by the `status` query — consumed by `otelop info` when reporting an
	// instance's effective configuration.
	LogLevel string

	// Retention is the parsed retention window, used to compute the default
	// "full retention window" for traces/metrics/logs queries when no
	// explicit from/to args are given.
	Retention time.Duration
	// StoragePath, RetentionDisplay, and MaxSizeDisplay are the raw
	// configured values (as given in the TOML/CLI/env config) surfaced
	// as-is by the `config` query — e.g. RetentionDisplay "7d" rather than
	// Retention.String()'s "168h0m0s".
	StoragePath      string
	RetentionDisplay string
	MaxSizeDisplay   string
}

// maxQueryDepth bounds field nesting depth (graph-gophers counts the
// top-level query/mutation field itself as depth 1, then +1 per nested
// selection level — see internal/validation/validation.go's
// validateMaxDepth in the graph-gophers/graphql-go v1.10.2 module source).
// It exists because the schema has a circular Trace.spans <-> Span.trace
// <-> Trace.logs <-> Log.trace edge with no built-in depth limit, so an
// unbounded query like
// `traces(limit:0){spans{trace{logs{trace{spans{...}}}}}}` would otherwise
// make the resolver count grow with every extra nesting level a client
// cares to type.
//
// The deepest real document is a standard GraphQL introspection query
// (`{ __schema { queryType { fields { name description args { name type {
// name ofType { name } } } } } } }`, the shape any GraphQL client — codegen
// tooling, GraphiQL, an ad-hoc script — runs to discover the schema before
// it knows the field names) at depth 7; the frontend's deepest data query
// (trace { spans { ...SpanFields } }, whose SpanFields fragment nests
// `events`) reaches depth 4. 15 is roughly double the deeper of the two
// (7), leaving headroom for query shapes not enumerated here while still
// keeping the circular edge's fan-out bounded.
const maxQueryDepth = 15

// maxQueryLength bounds the raw query document size in bytes. Every real
// document (frontend's generated queries, the introspection example above)
// is well under 1KB; 50KB is a generous multiple of that, comfortably above
// any legitimate query while still rejecting a pathological giant document
// before it reaches parsing/validation.
const maxQueryLength = 50 * 1024

// MustNewSchema parses the embedded schema and binds it to a resolver backed
// by the given storage. It panics on schema errors so misconfigurations fail
// at startup, not at query time.
func MustNewSchema(s *storage.Storage, runtime RuntimeInfo) *gql.Schema {
	return gql.MustParseSchema(schemaSource, &Resolver{storage: s, runtime: runtime},
		gql.Tracer(slogTracer{}),
		gql.MaxDepth(maxQueryDepth),
		gql.MaxQueryLength(maxQueryLength),
	)
}

// Source returns the raw GraphQL schema document. Useful for tests and for
// surfacing the schema to clients that cannot rely on introspection.
func Source() string { return schemaSource }
