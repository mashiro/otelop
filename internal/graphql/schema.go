// Package graphql exposes otelop's in-memory telemetry store to callers via a
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

// MustNewSchema parses the embedded schema and binds it to a resolver backed
// by the given storage. It panics on schema errors so misconfigurations fail
// at startup, not at query time.
func MustNewSchema(s *storage.Storage, runtime RuntimeInfo) *gql.Schema {
	return gql.MustParseSchema(schemaSource, &Resolver{storage: s, runtime: runtime}, gql.Tracer(slogTracer{}))
}

// Source returns the raw GraphQL schema document. Useful for tests and for
// surfacing the schema to clients that cannot rely on introspection.
func Source() string { return schemaSource }
