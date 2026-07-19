import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import {
  addTracesAtom,
  removeTraceAtom,
  addMetricsAtom,
  addLogsAtom,
  wsStatusAtom,
} from "@/stores/telemetry";
import type { TraceData, TraceDeleteData, MetricData, LogData, WsMessage } from "@/types/telemetry";
import { wsManager } from "@/lib/websocket-manager";

// A live tab can receive a WS message per span/metric-point/log-line;
// writing straight to jotai on every single message forces a full
// array-rebuild + derived-atom recompute + table reconcile per message. This
// bounds how often that whole chain runs to once per flush window instead —
// messages just accumulate in queueRef until the window elapses, then get
// applied as one batched store update via the add*Atoms below.
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
  // re-render — only the eventual batched atom write should.
  const queueRef = useRef<WsMessage[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function flush() {
      timerRef.current = null;
      const queue = queueRef.current;
      queueRef.current = [];
      if (queue.length === 0) return;

      // Coalesce contiguous runs of the same message type into one batched
      // write, but don't group by type globally — that would reorder a
      // delete relative to an add for the same trace that arrived between
      // two same-type runs (e.g. add, delete, add). Splitting only at type
      // boundaries preserves arrival order while still batching the common
      // case: a burst of same-type deliveries.
      let i = 0;
      while (i < queue.length) {
        const type = queue[i].type;
        let j = i;
        while (j < queue.length && queue[j].type === type) j++;
        const run = queue.slice(i, j);
        switch (type) {
          case "traces":
            addTraces(run.map((m) => m.data as TraceData));
            break;
          case "trace-deletes":
            for (const m of run) removeTrace((m.data as TraceDeleteData).traceId);
            break;
          case "metrics":
            addMetrics(run.map((m) => m.data as MetricData));
            break;
          case "logs":
            addLogs(run.map((m) => m.data as LogData));
            break;
        }
        i = j;
      }
    }

    const unsubscribe = wsManager.subscribe({
      onStatus: setWsStatus,
      onMessage: (msg) => {
        queueRef.current.push(msg);
        if (timerRef.current === null) {
          timerRef.current = setTimeout(flush, WS_FLUSH_INTERVAL_MS);
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
