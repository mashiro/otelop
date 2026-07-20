import { useEffect } from "react";
import { useSetAtom } from "jotai";
import {
  addTraceAtom,
  removeTraceAtom,
  addMetricAtom,
  addLogAtom,
  wsStatusAtom,
} from "@/stores/telemetry";
import type {
  TraceDataWire,
  TraceDeleteData,
  MetricDataWire,
  LogDataWire,
} from "@/types/telemetry";
import { normalizeTrace, normalizeMetric, normalizeLog } from "@/lib/normalize";
import { wsManager } from "@/lib/websocket-manager";

// useWebSocket is a thin adapter that bridges the module-level WsManager to
// this component's jotai atoms. The actual WebSocket lifecycle (connect,
// reconnect, teardown) lives in WsManager — keeping it out of React means
// Strict Mode's double-invoke effect cycle no longer creates-then-closes a
// fresh socket on every mount.
export function useWebSocket(): void {
  const setWsStatus = useSetAtom(wsStatusAtom);
  const addTrace = useSetAtom(addTraceAtom);
  const removeTrace = useSetAtom(removeTraceAtom);
  const addMetric = useSetAtom(addMetricAtom);
  const addLog = useSetAtom(addLogAtom);

  useEffect(() => {
    const unsubscribe = wsManager.subscribe({
      onStatus: setWsStatus,
      // The manager only JSON.parses the WS payload — it's still wire-shaped
      // (ISO timestamp strings, no epoch fields). This is the single place
      // that normalizes a live delivery before it reaches the store, so
      // addTraceAtom/addMetricAtom/addLogAtom never see an un-normalized
      // record (see lib/normalize.ts).
      onMessage: (msg) => {
        switch (msg.type) {
          case "traces":
            addTrace(normalizeTrace(msg.data as TraceDataWire));
            break;
          case "trace-deletes":
            removeTrace((msg.data as TraceDeleteData).traceId);
            break;
          case "metrics":
            addMetric(normalizeMetric(msg.data as MetricDataWire));
            break;
          case "logs":
            addLog(normalizeLog(msg.data as LogDataWire));
            break;
        }
      },
    });
    return unsubscribe;
  }, [setWsStatus, addTrace, removeTrace, addMetric, addLog]);
}
