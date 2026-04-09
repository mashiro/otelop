import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import { TraceList } from "@/components/traces/trace-list";
import { MetricList } from "@/components/metrics/metric-list";
import { LogList } from "@/components/logs/log-list";
import { useWebSocket } from "@/hooks/use-websocket";
import {
  setTracesAtom,
  setMetricsAtom,
  setLogsAtom,
  activeTabAtom,
} from "@/stores/telemetry";
import type { PaginatedResponse, TraceData, MetricData, LogData } from "@/types/telemetry";
import type { TabValue } from "@/stores/telemetry";

function App() {
  useWebSocket();

  const setTraces = useSetAtom(setTracesAtom);
  const setMetrics = useSetAtom(setMetricsAtom);
  const setLogs = useSetAtom(setLogsAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

  useEffect(() => {
    const load = async () => {
      try {
        const [tRes, mRes, lRes] = await Promise.all([
          fetch("/api/traces?limit=200"),
          fetch("/api/metrics?limit=200"),
          fetch("/api/logs?limit=200"),
        ]);
        const traces: PaginatedResponse<TraceData> = await tRes.json();
        const metrics: PaginatedResponse<MetricData> = await mRes.json();
        const logs: PaginatedResponse<LogData> = await lRes.json();
        setTraces(traces.data);
        setMetrics(metrics.data);
        setLogs(logs.data);
      } catch {
        // WebSocket will deliver data later
      }
    };
    void load();
  }, [setTraces, setMetrics, setLogs]);

  return (
    <div className="noise-bg mesh-bg flex h-screen flex-col text-foreground">
      <Header />
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="px-5 pt-3">
          <TabsList className="w-fit gap-1 bg-transparent p-0">
            <TabsTrigger
              value="traces"
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-trace/15 data-active:text-trace data-active:shadow-[0_0_12px_oklch(0.75_0.14_195/15%)] hover:text-foreground"
            >
              Traces
            </TabsTrigger>
            <TabsTrigger
              value="metrics"
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-metric/15 data-active:text-metric data-active:shadow-[0_0_12px_oklch(0.78_0.14_80/15%)] hover:text-foreground"
            >
              Metrics
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-log/15 data-active:text-log data-active:shadow-[0_0_12px_oklch(0.72_0.14_300/15%)] hover:text-foreground"
            >
              Logs
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="traces" className="relative z-10 flex-1 overflow-hidden px-5 pb-4 pt-3">
          <TraceList />
        </TabsContent>
        <TabsContent value="metrics" className="relative z-10 flex-1 overflow-hidden px-5 pb-4 pt-3">
          <MetricList />
        </TabsContent>
        <TabsContent value="logs" className="relative z-10 flex-1 overflow-hidden px-5 pb-4 pt-3">
          <LogList />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default App;
