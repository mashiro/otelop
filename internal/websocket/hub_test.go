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

	// Client with tiny buffer, intentionally pre-filled to simulate a slow reader.
	slowClient := &Client{hub: hub, send: make(chan []byte, 1)}
	slowClient.send <- []byte("placeholder")

	hub.Register(slowClient)
	time.Sleep(10 * time.Millisecond)

	// Dispatch a broadcast. Because the client buffer is already full, the hub
	// must drop the new payload rather than block waiting for the slow reader.
	hub.Broadcast(Message{Type: store.SignalLogs, Data: "msg-should-drop"})

	// Give the hub Run goroutine a chance to attempt delivery and drop.
	time.Sleep(20 * time.Millisecond)

	// Drain the pre-filled value.
	select {
	case msg := <-slowClient.send:
		if string(msg) != "placeholder" {
			t.Errorf("first message = %q, want placeholder", string(msg))
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected placeholder message")
	}

	// Nothing more should arrive — the broadcast was dropped for this slow client.
	select {
	case extra := <-slowClient.send:
		t.Errorf("expected broadcast to be dropped, but got %q", string(extra))
	case <-time.After(50 * time.Millisecond):
	}
}

func TestHub_BroadcastIsNonBlockingAndPreservesOrder(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	client := &Client{hub: hub, send: make(chan []byte, 8)}
	hub.Register(client)
	time.Sleep(10 * time.Millisecond)

	for i := 0; i < 5; i++ {
		hub.Broadcast(Message{Type: store.SignalLogs, Data: i})
	}

	received := 0
	timeout := time.After(200 * time.Millisecond)
	for received < 5 {
		select {
		case <-client.send:
			received++
		case <-timeout:
			t.Fatalf("only received %d of 5 messages", received)
		}
	}
}

func TestHub_BroadcastWithNoClients_IsNoop(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	// Must not panic or block even without any clients connected.
	hub.Broadcast(Message{Type: store.SignalTraces, Data: "x"})
	time.Sleep(10 * time.Millisecond)
	if hub.ClientCount() != 0 {
		t.Errorf("ClientCount = %d, want 0", hub.ClientCount())
	}
}
