package websocket

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync/atomic"

	"github.com/mashiro/otelop/internal/store"
)

// broadcastQueueSize bounds how many pending broadcasts the hub will queue
// before dropping them. Large enough to absorb bursts, small enough that a
// stuck hub goroutine can't OOM the process.
const broadcastQueueSize = 1024

// Message is sent to WebSocket clients.
type Message struct {
	Type store.SignalType `json:"type"`
	Data any              `json:"data"`
}

// Hub manages WebSocket client connections and broadcasts messages.
// All map mutations happen inside Run, so no mutex is needed on the hot path.
type Hub struct {
	clients    map[*Client]struct{}
	register   chan *Client
	unregister chan *Client
	broadcast  chan Message
	count      atomic.Int64
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]struct{}),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Message, broadcastQueueSize),
	}
}

// Run starts the hub event loop. It blocks until ctx is cancelled.
// The Run goroutine is the sole owner of the clients map and the only writer
// to client.send, which means Broadcast callers never block on JSON marshaling.
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			for client := range h.clients {
				close(client.send)
				delete(h.clients, client)
			}
			h.count.Store(0)
			return
		case client := <-h.register:
			h.clients[client] = struct{}{}
			h.count.Store(int64(len(h.clients)))
			slog.Debug("websocket: client connected", "clients", len(h.clients))
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				close(client.send)
				delete(h.clients, client)
				h.count.Store(int64(len(h.clients)))
			}
			slog.Debug("websocket: client disconnected", "clients", len(h.clients))
		case msg := <-h.broadcast:
			h.dispatch(msg)
		}
	}
}

// dispatch marshals and fans out a single broadcast message. Runs only inside Run.
func (h *Hub) dispatch(msg Message) {
	if len(h.clients) == 0 {
		return
	}
	data, err := json.Marshal(msg)
	if err != nil {
		slog.Error("websocket: failed to marshal message", "error", err)
		return
	}
	for client := range h.clients {
		select {
		case client.send <- data:
		default:
			// Client buffer full, drop this message for the slow client.
		}
	}
}

// Register adds a client to the hub.
func (h *Hub) Register(c *Client) {
	h.register <- c
}

// Unregister removes a client from the hub.
func (h *Hub) Unregister(c *Client) {
	h.unregister <- c
}

// Broadcast enqueues a message for asynchronous fan-out. It is non-blocking:
// if the broadcast queue is full the message is dropped rather than stalling
// the caller (typically a store write path).
func (h *Hub) Broadcast(msg Message) {
	if h.count.Load() == 0 {
		return
	}
	select {
	case h.broadcast <- msg:
	default:
		slog.Warn("websocket: broadcast queue full, dropping message")
	}
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	return int(h.count.Load())
}
