import { useEffect, useRef, useCallback } from "react";
import { useSetAtom } from "jotai";
import { addTraceAtom, addMetricAtom, addLogAtom, wsStatusAtom } from "@/stores/telemetry";
import type { TraceData, MetricData, LogData, WsMessage } from "@/types/telemetry";

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function useWebSocket(): void {
  const setWsStatus = useSetAtom(wsStatusAtom);
  const addTrace = useSetAtom(addTraceAtom);
  const addMetric = useSetAtom(addMetricAtom);
  const addLog = useSetAtom(addLogAtom);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountIdRef = useRef(0);

  const connect = useCallback(
    (mountId: number) => {
      if (mountIdRef.current !== mountId) return;

      if (wsRef.current) {
        wsRef.current.close();
      }

      setWsStatus("connecting");
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (mountIdRef.current !== mountId) {
          ws.close();
          return;
        }
        setWsStatus("connected");
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      };

      ws.onmessage = (event: MessageEvent) => {
        if (mountIdRef.current !== mountId) return;
        try {
          const msg: WsMessage = JSON.parse(event.data as string);
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
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (mountIdRef.current !== mountId) return;
        setWsStatus("disconnected");
        wsRef.current = null;
        const delay = reconnectDelayRef.current;
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
          connect(mountId);
        }, delay);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    },
    [setWsStatus, addTrace, addMetric, addLog],
  );

  useEffect(() => {
    const mountId = ++mountIdRef.current;
    connect(mountId);
    return () => {
      mountIdRef.current = -1;
      clearTimeout(reconnectTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        wsRef.current = null;
        ws.close();
      }
    };
  }, [connect]);
}
