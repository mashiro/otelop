import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { addTraceAtom, addMetricAtom, addLogAtom, wsStatusAtom } from "@/stores/telemetry";
import type { TraceData, MetricData, LogData } from "@/types/telemetry";
import { wsManager } from "@/lib/websocket-manager";

// useWebSocket is a thin adapter that bridges the module-level WsManager to
// this component's jotai atoms. The actual WebSocket lifecycle (connect,
// reconnect, teardown) lives in WsManager — keeping it out of React means
// Strict Mode's double-invoke effect cycle no longer creates-then-closes a
// fresh socket on every mount.
export function useWebSocket(): void {
  const setWsStatus = useSetAtom(wsStatusAtom);
  const addTrace = useSetAtom(addTraceAtom);
  const addMetric = useSetAtom(addMetricAtom);
  const addLog = useSetAtom(addLogAtom);

  useEffect(() => {
    const unsubscribe = wsManager.subscribe({
      onStatus: setWsStatus,
      onMessage: (msg) => {
        switch (msg.type) {
          case "traces":
            addTrace(msg.data as TraceData);
            break;
          case "metrics":
            addMetric(msg.data as MetricData);
            break;
          case "logs":
            addLog(msg.data as LogData);
            break;
        }
      },
    });
    return unsubscribe;
  }, [setWsStatus, addTrace, addMetric, addLog]);
}
