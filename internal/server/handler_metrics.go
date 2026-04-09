package server

import "net/http"

func (s *Server) handleGetMetrics(w http.ResponseWriter, r *http.Request) {
	limit, offset := parsePagination(r)
	metrics := s.store.GetMetrics()

	total := len(metrics)
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
