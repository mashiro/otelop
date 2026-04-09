package server

import (
	"encoding/json"
	"net/http"
	"strconv"
)

func (s *Server) handleGetTraces(w http.ResponseWriter, r *http.Request) {
	limit, offset := parsePagination(r)
	traces := s.store.GetTraces()

	total := len(traces)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := traces[offset:end]

	writeJSON(w, map[string]any{
		"data":   page,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (s *Server) handleGetTraceByID(w http.ResponseWriter, r *http.Request) {
	traceID := r.PathValue("traceID")
	trace, ok := s.store.GetTraceByID(traceID)
	if !ok {
		http.Error(w, "trace not found", http.StatusNotFound)
		return
	}
	writeJSON(w, trace)
}

func parsePagination(r *http.Request) (limit, offset int) {
	limit = 50
	offset = 0

	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
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
