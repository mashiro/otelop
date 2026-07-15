package websocket

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/mashiro/otelop/internal/broadcast"
	"github.com/mashiro/otelop/internal/selftelemetry"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// broadcastQueueSize bounds how many pending broadcasts the hub will queue
// before dropping them. Large enough to absorb bursts, small enough that a
// stuck hub goroutine can't OOM the process.
const broadcastQueueSize = 1024

// Message is sent to WebSocket clients.
type Message struct {
	Type broadcast.SignalType `json:"type"`
	Data any                  `json:"data"`
}

type broadcastJob struct {
	ctx        context.Context
	enqueuedAt time.Time
	message    Message
}

// Hub manages WebSocket client connections and broadcasts messages.
// All map mutations happen inside Run, so no mutex is needed on the hot path.
type Hub struct {
	clients    map[*Client]struct{}
	register   chan *Client
	unregister chan *Client
	broadcast  chan broadcastJob
	count      atomic.Int64
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]struct{}),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan broadcastJob, broadcastQueueSize),
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
		case job := <-h.broadcast:
			h.dispatch(job)
		}
	}
}

// dispatch marshals and fans out a single broadcast message. Runs only inside Run.
func (h *Hub) dispatch(job broadcastJob) {
	_, span := startWebSocketSpan(job.ctx, "websocket.dispatch",
		attribute.String("storage.signal", string(job.message.Type)),
		attribute.Int("websocket.clients", h.ClientCount()),
		attribute.Float64("websocket.queue.wait_ms", float64(time.Since(job.enqueuedAt).Microseconds())/1000))
	defer span.End()
	if len(h.clients) == 0 {
		return
	}
	data, err := json.Marshal(job.message)
	if err != nil {
		span.RecordError(err)
		slog.Error("websocket: failed to marshal message", "error", err)
		return
	}
	span.SetAttributes(attribute.Int("websocket.message.bytes", len(data)))
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
	h.BroadcastContext(context.Background(), msg)
}

// BroadcastContext is Broadcast with trace context propagation for the
// storage-to-WebSocket delivery path.
func (h *Hub) BroadcastContext(ctx context.Context, msg Message) {
	ctx, span := startWebSocketSpan(ctx, "websocket.Broadcast",
		attribute.String("storage.signal", string(msg.Type)),
		attribute.Int("websocket.clients", h.ClientCount()))
	defer span.End()
	if h.count.Load() == 0 {
		return
	}
	select {
	case h.broadcast <- broadcastJob{ctx: context.WithoutCancel(ctx), enqueuedAt: time.Now(), message: msg}:
	default:
		slog.Warn("websocket: broadcast queue full, dropping message")
	}
}

func startWebSocketSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	if selftelemetry.TracingSuppressed(ctx) {
		return ctx, trace.SpanFromContext(context.Background())
	}
	return otel.Tracer("otelop/websocket").Start(ctx, name, trace.WithAttributes(attrs...))
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	return int(h.count.Load())
}
