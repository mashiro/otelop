package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"

	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/store"
)

const testVersion = "test"

// newTestSession wires an otelop MCP server to an in-memory client session so
// tests can exercise tool calls without spinning up a real HTTP transport.
func newTestSession(t *testing.T, s *store.Store) *sdkmcp.ClientSession {
	t.Helper()
	ctx := context.Background()
	server := NewServer(otelopgraphql.MustNewSchema(s, otelopgraphql.RuntimeInfo{}), testVersion)

	serverTransport, clientTransport := sdkmcp.NewInMemoryTransports()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatalf("server connect: %v", err)
	}
	client := sdkmcp.NewClient(&sdkmcp.Implementation{Name: "test-client", Version: testVersion}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func callQuery(t *testing.T, session *sdkmcp.ClientSession, query string, vars map[string]any) map[string]any {
	t.Helper()
	args := map[string]any{"query": query}
	if vars != nil {
		args["variables"] = vars
	}
	res, err := session.CallTool(context.Background(), &sdkmcp.CallToolParams{Name: "query", Arguments: args})
	if err != nil {
		t.Fatalf("call query: %v", err)
	}
	if len(res.Content) == 0 {
		t.Fatalf("empty content")
	}
	text, ok := res.Content[0].(*sdkmcp.TextContent)
	if !ok {
		t.Fatalf("expected TextContent, got %T", res.Content[0])
	}
	var resp struct {
		Data   map[string]any   `json:"data"`
		Errors []map[string]any `json:"errors,omitempty"`
	}
	if err := json.Unmarshal([]byte(text.Text), &resp); err != nil {
		t.Fatalf("unmarshal %q: %v", text.Text, err)
	}
	if len(resp.Errors) > 0 && !res.IsError {
		t.Errorf("errors present but IsError not set: %+v", resp.Errors)
	}
	return resp.Data
}

func TestListTools_SingleQueryTool(t *testing.T) {
	session := newTestSession(t, store.NewStore(10, 10, 10, 100, nil))

	res, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	if len(res.Tools) != 1 || res.Tools[0].Name != "query" {
		names := make([]string, len(res.Tools))
		for i, tool := range res.Tools {
			names[i] = tool.Name
		}
		t.Errorf("tools = %v, want [query]", names)
	}
}

func TestQueryTool_Config(t *testing.T) {
	s := store.NewStore(11, 22, 33, 44, nil)
	session := newTestSession(t, s)

	data := callQuery(t, session, `{ config { traceCap metricCap logCap maxDataPoints } }`, nil)
	cfg := data["config"].(map[string]any)
	if cfg["traceCap"].(float64) != 11 {
		t.Errorf("traceCap = %v, want 11", cfg["traceCap"])
	}
	if cfg["maxDataPoints"].(float64) != 44 {
		t.Errorf("maxDataPoints = %v, want 44", cfg["maxDataPoints"])
	}
}

func TestQueryTool_Introspection(t *testing.T) {
	// AI clients start with an introspection query to discover the schema —
	// make sure that round-trip works via the MCP tool.
	session := newTestSession(t, store.NewStore(10, 10, 10, 100, nil))
	data := callQuery(t, session, `{ __schema { queryType { name } } }`, nil)
	schema := data["__schema"].(map[string]any)
	qt := schema["queryType"].(map[string]any)
	if qt["name"] != "Query" {
		t.Errorf("queryType.name = %v, want Query", qt["name"])
	}
}

func TestQueryTool_ErrorSetsIsError(t *testing.T) {
	session := newTestSession(t, store.NewStore(10, 10, 10, 100, nil))
	args := map[string]any{"query": `{ nonexistentField }`}
	res, err := session.CallTool(context.Background(), &sdkmcp.CallToolParams{Name: "query", Arguments: args})
	if err != nil {
		t.Fatalf("call query: %v", err)
	}
	if !res.IsError {
		t.Errorf("expected IsError=true for invalid query")
	}
	text := res.Content[0].(*sdkmcp.TextContent).Text
	if !strings.Contains(text, "error") && !strings.Contains(text, "Cannot query") {
		t.Errorf("expected error payload, got %q", text)
	}
}
