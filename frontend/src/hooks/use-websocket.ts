import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import {
  addTracesAtom,
  removeTraceAtom,
  addMetricsAtom,
  addLogsAtom,
  wsStatusAtom,
} from "@/stores/telemetry";
import type {
  TraceDataWire,
  TraceDeleteData,
  MetricDataWire,
  LogDataWire,
  WsMessage,
} from "@/types/telemetry";
import { normalizeTrace, normalizeMetric, normalizeLog } from "@/lib/normalize";
import { wsManager } from "@/lib/websocket-manager";

// A live tab can receive a WS message per span/metric-point/log-line;
// writing straight to jotai on every single message forces a full
// array-rebuild + sort + derived-atom recompute + React reconcile per
// message (see stores/telemetry.ts's addTracesAtom/addMetricsAtom/
// addLogsAtom doc comments). This throttles that chain to at most one flush
// per WS_FLUSH_INTERVAL_MS — 50ms sits comfortably under the ~100ms
// threshold where UI updates start reading as laggy, and caps flushes at
// 20/s regardless of message rate during a burst. The window is
// leading-edge (see below): the very first message after idle is applied
// synchronously, so a sparse trickle of messages never pays this interval
// as extra latency — only a sustained burst does.
const WS_FLUSH_INTERVAL_MS = 50;

// useWebSocket is a thin adapter that bridges the module-level WsManager to
// this component's jotai atoms. The actual WebSocket lifecycle (connect,
// reconnect, teardown) lives in WsManager — keeping it out of React means
// Strict Mode's double-invoke effect cycle no longer creates-then-closes a
// fresh socket on every mount.
export function useWebSocket(): void {
  const setWsStatus = useSetAtom(wsStatusAtom);
  const addTraces = useSetAtom(addTracesAtom);
  const removeTrace = useSetAtom(removeTraceAtom);
  const addMetrics = useSetAtom(addMetricsAtom);
  const addLogs = useSetAtom(addLogsAtom);

  // Refs (not state) because queueing/flushing must not itself trigger a
  // re-render — only the eventual batched atom write should. timerRef
  // doubles as the window-open/closed flag: non-null means a flush window is
  // currently open (leading message already dispatched, or a previous tick
  // kept it open), null means the next message should be treated as leading.
  const queueRef = useRef<WsMessage[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // The manager only JSON.parses the WS payload — it's still wire-shaped
    // (ISO timestamp strings, no epoch fields). This is the single place
    // that normalizes a live delivery before it reaches the store, so
    // addTracesAtom/addMetricsAtom/addLogsAtom never see an un-normalized
    // record (see lib/normalize.ts).
    function dispatchRun(type: WsMessage["type"], run: WsMessage[]) {
      switch (type) {
        case "traces":
          addTraces(run.map((m) => normalizeTrace(m.data as TraceDataWire)));
          break;
        case "trace-deletes":
          for (const m of run) removeTrace((m.data as TraceDeleteData).traceId);
          break;
        case "metrics":
          addMetrics(run.map((m) => normalizeMetric(m.data as MetricDataWire)));
          break;
        case "logs":
          addLogs(run.map((m) => normalizeLog(m.data as LogDataWire)));
          break;
      }
    }

    // Coalesces contiguous runs of the same message type into one batched
    // write each, but doesn't group by type globally — that would reorder a
    // delete relative to an add for the same trace that arrived between two
    // same-type runs (e.g. add, delete, add). Splitting only at type
    // boundaries preserves arrival order while still batching the common
    // case: a burst of same-type deliveries.
    function dispatchQueue(queue: WsMessage[]) {
      let i = 0;
      while (i < queue.length) {
        const type = queue[i].type;
        let j = i;
        while (j < queue.length && queue[j].type === type) j++;
        dispatchRun(type, queue.slice(i, j));
        i = j;
      }
    }

    // Runs WS_FLUSH_INTERVAL_MS after the window opened (by the leading
    // message or the previous tick). An empty queue means nothing arrived
    // during this tick, so the window closes — the next message is treated
    // as leading again. A nonempty queue flushes and re-arms the timer,
    // keeping the window open for another tick so a sustained burst is
    // capped at one flush per interval instead of queuing without bound.
    function tick() {
      const queue = queueRef.current;
      queueRef.current = [];
      if (queue.length === 0) {
        timerRef.current = null;
        return;
      }
      dispatchQueue(queue);
      timerRef.current = setTimeout(tick, WS_FLUSH_INTERVAL_MS);
    }

    const unsubscribe = wsManager.subscribe({
      onStatus: setWsStatus,
      onMessage: (msg) => {
        if (timerRef.current === null) {
          // Leading edge: the window was closed, so this message applies
          // immediately instead of waiting out a flush interval it doesn't
          // need to share with anything else. Opening the window now gives
          // whatever arrives next a chance to batch instead of each also
          // dispatching synchronously.
          dispatchRun(msg.type, [msg]);
          timerRef.current = setTimeout(tick, WS_FLUSH_INTERVAL_MS);
        } else {
          queueRef.current.push(msg);
        }
      },
    });

    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [setWsStatus, addTraces, removeTrace, addMetrics, addLogs]);
}
