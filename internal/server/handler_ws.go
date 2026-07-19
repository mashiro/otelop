package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/coder/websocket"

	ws "github.com/mashiro/otelop/internal/websocket"
)

// wsOriginPatterns allow-lists browser Origins for the WebSocket upgrade.
// coder/websocket matches each pattern against the Origin's host:port with
// path.Match, so `[` and `]` (IPv6 literal delimiters) must be escaped —
// they're path.Match character-class metacharacters, not literal brackets.
// The request's own Host is always implicitly permitted by coder/websocket
// regardless of this list (see authenticateOrigin in accept.go), so
// same-origin browser connections and non-browser clients (which send no
// Origin header at all) are unaffected by this allowlist.
var wsOriginPatterns = []string{
	"localhost:*",
	"127.0.0.1:*",
	`\[::1\]:*`,
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns:  wsOriginPatterns,
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
