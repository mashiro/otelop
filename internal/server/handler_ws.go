package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/coder/websocket"

	ws "github.com/mashiro/otelop/internal/websocket"
)

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns:  []string{"*"},
		CompressionMode: websocket.CompressionNoContextTakeover,
	})
	if err != nil {
		slog.Error("websocket: accept error", "error", err)
		return
	}

	// Use a detached context — the HTTP request context is cancelled after upgrade.
	ctx, cancel := context.WithCancel(context.Background())

	client := ws.NewClient(s.hub, conn)
	s.hub.Register(client)

	go client.WritePump(ctx)
	go func() {
		client.ReadPump(ctx)
		cancel()
	}()
}
