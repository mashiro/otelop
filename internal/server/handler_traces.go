package server

import (
	"net/http"

	"go.opentelemetry.io/otel/attribute"

	"github.com/mashiro/otelop/internal/store"
)

func (s *Server) handleGetTraces(w http.ResponseWriter, r *http.Request) {
	writePaginated(w, r, "store.GetTracesPage", func(offset, limit int) ([]*store.TraceData, int) {
		return s.store.GetTracesPage(offset, limit)
	})
}

func (s *Server) handleGetTraceByID(w http.ResponseWriter, r *http.Request) {
	traceID := r.PathValue("traceID")
	_, span := tracer.Start(r.Context(), "store.GetTraceByID")
	defer span.End()
	trace, ok := s.store.GetTraceByID(traceID)
	span.SetAttributes(attribute.String("trace_id", traceID), attribute.Bool("found", ok))
	if !ok {
		http.Error(w, "trace not found", http.StatusNotFound)
		return
	}
	writeJSON(w, trace)
}
