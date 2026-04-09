package websocket

import (
	"context"
	"testing"
	"time"

	"github.com/mashiro/otelop/internal/store"
)

func TestHub_RegisterUnregister(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	// Create a fake client (no real websocket conn needed for this test).
	client := &Client{
		hub:  hub,
		send: make(chan []byte, sendBufferSize),
	}

	hub.Register(client)
	time.Sleep(10 * time.Millisecond)

	if hub.ClientCount() != 1 {
		t.Fatalf("expected 1 client, got %d", hub.ClientCount())
	}

	hub.Unregister(client)
	time.Sleep(10 * time.Millisecond)

	if hub.ClientCount() != 0 {
		t.Fatalf("expected 0 clients, got %d", hub.ClientCount())
	}
}

func TestHub_Broadcast(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	client1 := &Client{hub: hub, send: make(chan []byte, sendBufferSize)}
	client2 := &Client{hub: hub, send: make(chan []byte, sendBufferSize)}

	hub.Register(client1)
	hub.Register(client2)
	time.Sleep(10 * time.Millisecond)

	hub.Broadcast(Message{
		Type: store.SignalTraces,
		Data: map[string]string{"test": "data"},
	})

	select {
	case msg := <-client1.send:
		if len(msg) == 0 {
			t.Error("expected non-empty message for client1")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("client1 did not receive message")
	}

	select {
	case msg := <-client2.send:
		if len(msg) == 0 {
			t.Error("expected non-empty message for client2")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("client2 did not receive message")
	}
}

func TestHub_BroadcastDropsSlowClient(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	// Client with tiny buffer.
	slowClient := &Client{hub: hub, send: make(chan []byte, 1)}
	hub.Register(slowClient)
	time.Sleep(10 * time.Millisecond)

	// Fill the buffer.
	hub.Broadcast(Message{Type: store.SignalLogs, Data: "msg1"})
	// This should be dropped (buffer full).
	hub.Broadcast(Message{Type: store.SignalLogs, Data: "msg2"})

	// Should only receive one message.
	select {
	case <-slowClient.send:
	case <-time.After(100 * time.Millisecond):
		t.Error("expected at least one message")
	}

	select {
	case <-slowClient.send:
		t.Error("expected second message to be dropped")
	case <-time.After(50 * time.Millisecond):
		// Good, message was dropped.
	}
}
