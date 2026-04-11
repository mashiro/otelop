package server

import (
	"net/http"

	"github.com/mashiro/otelop/internal/store"
)

func (s *Server) handleGetMetrics(w http.ResponseWriter, r *http.Request) {
	writePaginated(w, r, "store.GetMetricsPage", func(offset, limit int) ([]*store.MetricData, int) {
		return s.store.GetMetricsPage(offset, limit)
	})
}
