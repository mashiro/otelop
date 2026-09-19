package docs

import (
	"strings"
	"testing"
)

func TestList(t *testing.T) {
	documents, err := List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(documents) < 4 {
		t.Fatalf("List returned %d documents, want at least 4", len(documents))
	}
	for i, document := range documents {
		if document.Name == "" || document.Description == "" {
			t.Errorf("document %d has empty metadata: %#v", i, document)
		}
		if i > 0 && documents[i-1].Name >= document.Name {
			t.Errorf("documents are not sorted: %q before %q", documents[i-1].Name, document.Name)
		}
	}
}

func TestShow(t *testing.T) {
	body, err := Show("getting-started")
	if err != nil {
		t.Fatalf("Show: %v", err)
	}
	if !strings.HasPrefix(body, "# Getting started") {
		t.Fatalf("Show returned unexpected body: %q", body)
	}
	if strings.Contains(body, "description:") {
		t.Fatalf("Show returned frontmatter: %q", body)
	}
}

func TestShowRejectsUnknownAndPaths(t *testing.T) {
	for _, name := range []string{"missing", "getting-started.md", "design/duckdb-storage", "../README"} {
		if _, err := Show(name); err == nil {
			t.Errorf("Show(%q) succeeded, want error", name)
		}
	}
}

func TestParseFrontmatter(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		description string
		wantErr     bool
	}{
		{name: "quoted", input: "---\ndescription: \"Use when: a value contains punctuation.\"\n---\n# Body\n", description: "Use when: a value contains punctuation."},
		{name: "folded", input: "---\ndescription: >-\n  First line\n  continues here.\n---\n# Body\n", description: "First line continues here."},
		{name: "missing", input: "---\n---\n# Body\n", wantErr: true},
		{name: "unknown field", input: "---\ndescription: Valid\ntitle: Unexpected\n---\n# Body\n", wantErr: true},
		{name: "invalid YAML", input: "---\ndescription: [invalid\n---\n# Body\n", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			description, body, err := parse([]byte(tt.input))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parse succeeded, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if description != tt.description {
				t.Errorf("description = %q, want %q", description, tt.description)
			}
			if body != "# Body\n" {
				t.Errorf("body = %q, want # Body", body)
			}
		})
	}
}
