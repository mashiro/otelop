package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"

	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/storage"
)

const testVersion = "test"

// newTestStorage opens an in-memory storage.Storage for tests.
func newTestStorage(t *testing.T) *storage.Storage {
	t.Helper()
	s, err := storage.Open(context.Background(), storage.Options{})
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Errorf("storage.Close: %v", err)
		}
	})
	return s
}

// newTestSession wires an otelop MCP server to an in-memory client session so
// tests can exercise tool calls without spinning up a real HTTP transport.
func newTestSession(t *testing.T, s *storage.Storage) *sdkmcp.ClientSession {
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
	session := newTestSession(t, newTestStorage(t))

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
	s := newTestStorage(t)
	session := newTestSession(t, s)

	data := callQuery(t, session, `{ config { storagePath retention maxSize traceCount metricCount logCount } }`, nil)
	cfg := data["config"].(map[string]any)
	if cfg["traceCount"].(float64) != 0 {
		t.Errorf("traceCount = %v, want 0", cfg["traceCount"])
	}
	if _, ok := cfg["retention"]; !ok {
		t.Errorf("expected retention field in config, got %v", cfg)
	}
}

func TestQueryTool_Introspection(t *testing.T) {
	// AI clients start with an introspection query to discover the schema —
	// make sure that round-trip works via the MCP tool.
	session := newTestSession(t, newTestStorage(t))
	data := callQuery(t, session, `{ __schema { queryType { name } } }`, nil)
	schema := data["__schema"].(map[string]any)
	qt := schema["queryType"].(map[string]any)
	if qt["name"] != "Query" {
		t.Errorf("queryType.name = %v, want Query", qt["name"])
	}
}

func TestQueryTool_ErrorSetsIsError(t *testing.T) {
	session := newTestSession(t, newTestStorage(t))
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
