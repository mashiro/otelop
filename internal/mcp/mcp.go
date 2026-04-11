// Package mcp exposes otelop's GraphQL schema to AI clients via the Model
// Context Protocol. The MCP server provides a single `query` tool — a thin
// wrapper over the in-process GraphQL schema — instead of a bespoke tool per
// signal type. AI clients are expected to discover the schema via
// introspection (`{ __schema { types { name } } }`) and then build their own
// queries, paying only for the fields they actually read.
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	gqlgo "github.com/graph-gophers/graphql-go"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
)

const ServerName = "otelop"

// NewHandler returns an http.Handler that serves otelop's MCP server over
// streamable HTTP against the supplied GraphQL schema. The caller owns the
// schema so the HTTP server and MCP share a single parsed instance.
func NewHandler(schema *gqlgo.Schema, version string) http.Handler {
	srv := NewServer(schema, version)
	return sdkmcp.NewStreamableHTTPHandler(func(*http.Request) *sdkmcp.Server {
		return srv
	}, nil)
}

func NewServer(schema *gqlgo.Schema, version string) *sdkmcp.Server {
	srv := sdkmcp.NewServer(&sdkmcp.Implementation{
		Name:    ServerName,
		Version: version,
	}, nil)
	registerTools(srv, schema)
	return srv
}

type queryInput struct {
	Query         string         `json:"query" jsonschema:"GraphQL query or mutation document. Start with '{ __schema { types { name fields { name } } } }' to discover the schema, then build focused queries that only request the fields you need."`
	Variables     map[string]any `json:"variables,omitempty" jsonschema:"Optional GraphQL variables map."`
	OperationName string         `json:"operationName,omitempty" jsonschema:"Optional operation name when the query document defines multiple operations."`
}

func registerTools(srv *sdkmcp.Server, schema *gqlgo.Schema) {
	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name: "query",
		Description: `Execute a GraphQL query or mutation against otelop's buffered traces, metrics, and logs.

The schema has top-level fields traces / trace / metrics / logs / config plus a clearSignals mutation. Request only the fields you need — field selection keeps response size (and token cost) under control. For trace↔log correlation, prefer 'trace(traceId: "...") { logs { ... } }' over a second 'logs(traceId: ...)' call.

If you do not know the schema yet, first run an introspection query: '{ __schema { queryType { fields { name description args { name type { name ofType { name } } } } } } }'.`,
	}, func(ctx context.Context, _ *sdkmcp.CallToolRequest, in queryInput) (*sdkmcp.CallToolResult, any, error) {
		resp := schema.Exec(ctx, in.Query, in.OperationName, in.Variables)
		body, err := json.Marshal(resp)
		if err != nil {
			return nil, nil, fmt.Errorf("marshal graphql response: %w", err)
		}
		result := &sdkmcp.CallToolResult{
			Content: []sdkmcp.Content{&sdkmcp.TextContent{Text: string(body)}},
		}
		if len(resp.Errors) > 0 {
			result.IsError = true
		}
		return result, nil, nil
	})
}
