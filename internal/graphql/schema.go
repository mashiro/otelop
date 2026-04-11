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

	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/store"
)

//go:embed schema.graphql
var schemaSource string

// MustNewSchema parses the embedded schema and binds it to a resolver backed
// by the given store. It panics on schema errors so misconfigurations fail at
// startup, not at query time.
func MustNewSchema(s *store.Store) *gql.Schema {
	return gql.MustParseSchema(schemaSource, &Resolver{store: s}, gql.Tracer(slogTracer{}))
}

// Source returns the raw GraphQL schema document. Useful for tests and for
// surfacing the schema to clients that cannot rely on introspection.
func Source() string { return schemaSource }
