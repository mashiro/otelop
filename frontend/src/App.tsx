import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import { TraceList } from "@/components/traces/trace-list";
import { MetricList } from "@/components/metrics/metric-list";
import { LogList } from "@/components/logs/log-list";
import { useWebSocket } from "@/hooks/use-websocket";
import { setTracesAtom, setMetricsAtom, setLogsAtom } from "@/stores/telemetry";
import type { PaginatedResponse, TraceData, MetricData, LogData } from "@/types/telemetry";

function App() {
  useWebSocket();

  const setTraces = useSetAtom(setTracesAtom);
  const setMetrics = useSetAtom(setMetricsAtom);
  const setLogs = useSetAtom(setLogsAtom);

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
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <Tabs defaultValue="traces" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="traces">Traces</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="traces" className="flex-1 overflow-hidden px-4 pb-4">
          <TraceList />
        </TabsContent>
        <TabsContent value="metrics" className="flex-1 overflow-hidden px-4 pb-4">
          <MetricList />
        </TabsContent>
        <TabsContent value="logs" className="flex-1 overflow-hidden px-4 pb-4">
          <LogList />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default App;
