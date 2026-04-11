import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WsManager } from "./websocket-manager";
import type { WsMessage } from "@/types/telemetry";
import type { WsStatus } from "@/stores/telemetry";

// Minimal mock that emulates just enough of the browser WebSocket interface
// for WsManager. Each instance records its event handlers so tests can
// manually drive open/message/close.
class MockSocket {
  static instances: MockSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0; // CONNECTING
  closed = false;

  constructor() {
    MockSocket.instances.push(this);
  }

  close = vi.fn(() => {
    this.closed = true;
    this.readyState = 3; // CLOSED
  });

  // Test-only helpers:
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

// The manager reads WebSocket.CONNECTING / WebSocket.OPEN on the global.
// Polyfill the constants so the code under test compares against real ints.
beforeEach(() => {
  vi.stubGlobal("WebSocket", {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });
  MockSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function newManager() {
  return new WsManager({
    createSocket: () => new MockSocket() as unknown as WebSocket,
    initialReconnectDelay: 100,
    maxReconnectDelay: 1_000,
  });
}

describe("WsManager.subscribe", () => {
  it("creates a socket only on the first subscriber", () => {
    const mgr = newManager();
    const unsub1 = mgr.subscribe({ onMessage: vi.fn(), onStatus: vi.fn() });
    expect(MockSocket.instances).toHaveLength(1);

    const unsub2 = mgr.subscribe({ onMessage: vi.fn(), onStatus: vi.fn() });
    expect(MockSocket.instances).toHaveLength(1); // still one — shared

    unsub1();
    unsub2();
  });

  it("seeds new subscribers with the current status", () => {
    const mgr = newManager();
    const onStatus1 = vi.fn<(s: WsStatus) => void>();
    mgr.subscribe({ onMessage: vi.fn(), onStatus: onStatus1 });
    expect(onStatus1).toHaveBeenCalledWith("connecting");

    MockSocket.instances[0].simulateOpen();

    const onStatus2 = vi.fn<(s: WsStatus) => void>();
    mgr.subscribe({ onMessage: vi.fn(), onStatus: onStatus2 });
    expect(onStatus2).toHaveBeenCalledWith("connected");
  });

  it("fans out messages to every subscriber", () => {
    const mgr = newManager();
    const a = vi.fn<(m: WsMessage) => void>();
    const b = vi.fn<(m: WsMessage) => void>();
    mgr.subscribe({ onMessage: a, onStatus: vi.fn() });
    mgr.subscribe({ onMessage: b, onStatus: vi.fn() });

    MockSocket.instances[0].simulateOpen();
    MockSocket.instances[0].simulateMessage({
      type: "traces",
      data: { traceId: "t1" },
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toEqual({ type: "traces", data: { traceId: "t1" } });
  });

  it("ignores unparseable messages", () => {
    const mgr = newManager();
    const onMessage = vi.fn();
    mgr.subscribe({ onMessage, onStatus: vi.fn() });
    const sock = MockSocket.instances[0];
    sock.simulateOpen();

    // Directly deliver garbage; parse should swallow the error.
    sock.onmessage?.({ data: "not json" } as MessageEvent);
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe("WsManager.unsubscribe", () => {
  it("keeps the socket alive when a new subscriber arrives before the deferred disconnect fires (Strict Mode remount)", () => {
    const mgr = newManager();
    const unsub = mgr.subscribe({ onMessage: vi.fn(), onStatus: vi.fn() });
    expect(MockSocket.instances).toHaveLength(1);
    const sock = MockSocket.instances[0];

    unsub();
    // Simulates React Strict Mode immediately re-subscribing on remount.
    mgr.subscribe({ onMessage: vi.fn(), onStatus: vi.fn() });

    // Advance all timers: the pending disconnect should have been cancelled.
    vi.runAllTimers();

    expect(sock.close).not.toHaveBeenCalled();
    expect(MockSocket.instances).toHaveLength(1);
  });

  it("tears down the socket after the deferred window if no subscriber returns", () => {
    const mgr = newManager();
    const unsub = mgr.subscribe({ onMessage: vi.fn(), onStatus: vi.fn() });
    const sock = MockSocket.instances[0];
    sock.simulateOpen();

    unsub();
    // Defer tick.
    vi.advanceTimersByTime(1);

    expect(sock.close).toHaveBeenCalledTimes(1);
    expect(mgr.subscriberCount).toBe(0);
  });
});

describe("WsManager reconnect", () => {
  it("reconnects after an unexpected close using exponential backoff", () => {
    const mgr = newManager();
    const onStatus = vi.fn<(s: WsStatus) => void>();
    mgr.subscribe({ onMessage: vi.fn(), onStatus });
    MockSocket.instances[0].simulateOpen();

    // Server drops the connection.
    MockSocket.instances[0].simulateClose();

    // Disconnected status emitted.
    expect(onStatus).toHaveBeenCalledWith("disconnected");

    // First backoff delay = 100ms.
    vi.advanceTimersByTime(100);
    expect(MockSocket.instances).toHaveLength(2);

    MockSocket.instances[1].simulateClose();
    // Second delay doubles = 200ms.
    vi.advanceTimersByTime(200);
    expect(MockSocket.instances).toHaveLength(3);
  });

  it("does not reconnect once the last subscriber has left", () => {
    const mgr = newManager();
    const unsub = mgr.subscribe({ onMessage: vi.fn(), onStatus: vi.fn() });
    MockSocket.instances[0].simulateOpen();
    unsub();
    vi.advanceTimersByTime(1); // fire deferred disconnect

    // Advance well beyond the initial backoff to make sure no reconnect fires.
    vi.advanceTimersByTime(5_000);
    expect(MockSocket.instances).toHaveLength(1);
  });
});
