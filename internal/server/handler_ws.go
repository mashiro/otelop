package server

import (
	"log"
	"net/http"

	"github.com/coder/websocket"

	ws "github.com/mashiro/otelop/internal/websocket"
)

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Printf("websocket: accept error: %v", err)
		return
	}

	client := ws.NewClient(s.hub, conn)
	s.hub.Register(client)

	go client.WritePump(r.Context())
	go client.ReadPump(r.Context())
}
