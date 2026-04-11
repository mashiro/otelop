import type { WsMessage } from "@/types/telemetry";
import type { WsStatus } from "@/stores/telemetry";

type MessageListener = (msg: WsMessage) => void;
type StatusListener = (status: WsStatus) => void;

export interface Subscriber {
  onMessage: MessageListener;
  onStatus: StatusListener;
}

export interface WsManagerOptions {
  createSocket: () => WebSocket;
  initialReconnectDelay?: number;
  maxReconnectDelay?: number;
}

// WsManager owns the WebSocket lifecycle outside React so that Strict Mode's
// double-invoke useEffect cycle doesn't create-then-tear-down a new socket on
// every mount. React components subscribe through `subscribe()`, and the
// manager connects on the first subscriber and disconnects a tick after the
// last one leaves — giving Strict Mode's remount time to rescue the
// connection without the browser printing "closed before connection
// established" warnings.
export class WsManager {
  private ws: WebSocket | null = null;
  private subscribers = new Set<Subscriber>();
  private status: WsStatus = "disconnected";
  private reconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly createSocket: () => WebSocket;
  private readonly initialReconnectDelay: number;
  private readonly maxReconnectDelay: number;

  constructor(opts: WsManagerOptions) {
    this.createSocket = opts.createSocket;
    this.initialReconnectDelay = opts.initialReconnectDelay ?? 1_000;
    this.maxReconnectDelay = opts.maxReconnectDelay ?? 30_000;
    this.reconnectDelay = this.initialReconnectDelay;
  }

  subscribe(subscriber: Subscriber): () => void {
    // If a deferred disconnect was pending from a previous unmount, cancel it
    // — a new subscriber arrived in time to rescue the connection.
    if (this.disconnectTimer !== null) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    this.subscribers.add(subscriber);
    // Seed the new subscriber with the current status so it doesn't start in
    // a stale state.
    subscriber.onStatus(this.status);

    if (this.subscribers.size === 1 && !this.ws) {
      this.connect();
    }

    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) {
        // Defer the actual disconnect by a tick so React Strict Mode's
        // immediate remount (which unsubscribes then resubscribes within the
        // same JS turn) doesn't cause us to tear down the socket we're about
        // to need again.
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = null;
          if (this.subscribers.size === 0) {
            this.disconnect();
          }
        }, 0);
      }
    };
  }

  // For tests and diagnostics.
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private setStatus(status: WsStatus) {
    this.status = status;
    for (const sub of this.subscribers) {
      sub.onStatus(status);
    }
  }

  private connect() {
    this.setStatus("connecting");
    const ws = this.createSocket();
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.setStatus("connected");
      this.reconnectDelay = this.initialReconnectDelay;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (this.ws !== ws) return;
      try {
        const msg: WsMessage = JSON.parse(event.data as string);
        for (const sub of this.subscribers) {
          sub.onMessage(msg);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus("disconnected");
      if (this.subscribers.size > 0) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after this.
    };
  }

  private scheduleReconnect() {
    const delay = this.reconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(delay * 2, this.maxReconnectDelay);
      if (this.subscribers.size > 0 && !this.ws) {
        this.connect();
      }
    }, delay);
  }

  private disconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const ws = this.ws;
    if (ws) {
      this.ws = null;
      // Detach listeners so an in-flight close event doesn't re-enter the
      // manager after we've decided to disconnect.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }

    this.setStatus("disconnected");
    this.reconnectDelay = this.initialReconnectDelay;
  }
}

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

// Module-level singleton used by the React hook. The factory closure is
// captured at import time so tests can construct their own WsManager with a
// mock createSocket instead.
export const wsManager = new WsManager({
  createSocket: () => new WebSocket(getWsUrl()),
});
