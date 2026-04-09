package server

import "net/http"

func (s *Server) handleGetLogs(w http.ResponseWriter, r *http.Request) {
	limit, offset := parsePagination(r)
	logs := s.store.GetLogs()

	total := len(logs)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := logs[offset:end]

	writeJSON(w, map[string]any{
		"data":   page,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}
