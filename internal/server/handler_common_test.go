package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParsePagination(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		wantLimit  int
		wantOffset int
	}{
		{"defaults when empty", "", defaultLimit, 0},
		{"limit only", "limit=25", 25, 0},
		{"offset only", "offset=10", defaultLimit, 10},
		{"both", "limit=100&offset=50", 100, 50},
		{"invalid limit falls back", "limit=abc", defaultLimit, 0},
		{"negative limit ignored", "limit=-5", defaultLimit, 0},
		{"zero limit ignored", "limit=0", defaultLimit, 0},
		{"large limit passed through", "limit=99999", 99999, 0},
		{"invalid offset ignored", "offset=foo", defaultLimit, 0},
		{"negative offset ignored", "offset=-1", defaultLimit, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/?"+tt.query, nil)
			limit, offset := parsePagination(r)
			if limit != tt.wantLimit {
				t.Errorf("limit = %d, want %d", limit, tt.wantLimit)
			}
			if offset != tt.wantOffset {
				t.Errorf("offset = %d, want %d", offset, tt.wantOffset)
			}
		})
	}
}

func TestWritePaginated_EnvelopeShape(t *testing.T) {
	type item struct {
		ID int `json:"id"`
	}

	var gotOffset, gotLimit int
	fetch := func(offset, limit int) ([]*item, int) {
		gotOffset = offset
		gotLimit = limit
		return []*item{{ID: 1}, {ID: 2}}, 42
	}

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/?limit=2&offset=5", nil)
	w := httptest.NewRecorder()

	writePaginated(w, r, "test.span", fetch)

	if gotOffset != 5 {
		t.Errorf("fetch called with offset %d, want 5", gotOffset)
	}
	if gotLimit != 2 {
		t.Errorf("fetch called with limit %d, want 2", gotLimit)
	}

	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content-type = %q, want json", ct)
	}

	var envelope struct {
		Data   []item `json:"data"`
		Total  int    `json:"total"`
		Limit  int    `json:"limit"`
		Offset int    `json:"offset"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if envelope.Total != 42 {
		t.Errorf("total = %d, want 42", envelope.Total)
	}
	if envelope.Limit != 2 || envelope.Offset != 5 {
		t.Errorf("limit/offset = %d/%d, want 2/5", envelope.Limit, envelope.Offset)
	}
	if len(envelope.Data) != 2 || envelope.Data[0].ID != 1 {
		t.Errorf("data = %+v, want 2 items starting with id 1", envelope.Data)
	}
}
