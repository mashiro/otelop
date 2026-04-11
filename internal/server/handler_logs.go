package server

import (
	"net/http"

	"github.com/mashiro/otelop/internal/store"
)

func (s *Server) handleGetLogs(w http.ResponseWriter, r *http.Request) {
	writePaginated(w, r, "store.GetLogsPage", func(offset, limit int) ([]*store.LogData, int) {
		return s.store.GetLogsPage(offset, limit)
	})
}
