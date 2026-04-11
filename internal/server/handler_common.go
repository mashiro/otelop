package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
)

var tracer = otel.Tracer("otelop.server")

const (
	defaultLimit = 50
	maxLimit     = 10000
)

// pageFetcher returns a newest-first slice of items for the given offset/limit
// along with the total buffer size. Implementations are expected to take locks
// internally and return already-paginated data to keep the lock scope tight.
type pageFetcher[T any] func(offset, limit int) ([]T, int)

// writePaginated runs the fetcher and writes the standard JSON envelope
// ({data, total, limit, offset}) used by all signal list endpoints.
func writePaginated[T any](w http.ResponseWriter, r *http.Request, spanName string, fetch pageFetcher[T]) {
	limit, offset := parsePagination(r)

	_, span := tracer.Start(r.Context(), spanName)
	items, total := fetch(offset, limit)
	span.SetAttributes(attribute.Int("total", total), attribute.Int("returned", len(items)))
	span.End()

	writeJSON(w, map[string]any{
		"data":   items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func parsePagination(r *http.Request) (limit, offset int) {
	limit = defaultLimit
	offset = 0
	q := r.URL.Query()
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
			if limit > maxLimit {
				limit = maxLimit
			}
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return
}

func writeJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
