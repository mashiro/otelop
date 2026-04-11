import { useEffect } from "react";
import { useSetAtom } from "jotai";
import {
  setTracesAtom,
  setMetricsAtom,
  setLogsAtom,
  serverConfigAtom,
  type ServerConfig,
} from "@/stores/telemetry";
import type { TraceData, MetricData, LogData } from "@/types/telemetry";

// useInitialLoad fetches /api/config and then traces/metrics/logs once on
// mount, seeding the Jotai store so the UI has data before the WebSocket
// starts streaming deltas. Failures are swallowed — the WebSocket hook will
// deliver data later.
export function useInitialLoad() {
  const setTraces = useSetAtom(setTracesAtom);
  const setMetrics = useSetAtom(setMetricsAtom);
  const setLogs = useSetAtom(setLogsAtom);
  const setConfig = useSetAtom(serverConfigAtom);

  useEffect(() => {
    const load = async () => {
      try {
        const cfgRes = await fetch("/api/config");
        const cfg: ServerConfig = await cfgRes.json();
        setConfig(cfg);

        const [tRes, mRes, lRes] = await Promise.all([
          fetch(`/api/traces?limit=${cfg.traceCap}`),
          fetch(`/api/metrics?limit=${cfg.metricCap}`),
          fetch(`/api/logs?limit=${cfg.logCap}`),
        ]);
        const [traces, metrics, logs] = (await Promise.all([
          tRes.json(),
          mRes.json(),
          lRes.json(),
        ])) as [{ data: TraceData[] }, { data: MetricData[] }, { data: LogData[] }];
        setTraces(traces.data);
        setMetrics(metrics.data);
        setLogs(logs.data);
      } catch {
        // WebSocket will deliver data later.
      }
    };
    void load();
  }, [setTraces, setMetrics, setLogs, setConfig]);
}
