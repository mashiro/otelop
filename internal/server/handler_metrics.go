package server

import (
	"net/http"

	"go.opentelemetry.io/otel/attribute"
)

func (s *Server) handleGetMetrics(w http.ResponseWriter, r *http.Request) {
	limit, offset := parsePagination(r)

	_, span := tracer.Start(r.Context(), "store.GetMetrics")
	metrics := s.store.GetMetrics()
	total := len(metrics)
	span.SetAttributes(attribute.Int("total", total))
	span.End()
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := metrics[offset:end]

	writeJSON(w, map[string]any{
		"data":   page,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}
