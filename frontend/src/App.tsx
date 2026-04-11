import { useAtomValue, useSetAtom } from "jotai";
import { useThemeSync } from "@/hooks/use-theme";
import { useWebSocket } from "@/hooks/use-websocket";
import { useInitialLoad } from "@/hooks/use-initial-load";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import { TraceList } from "@/components/traces/trace-list";
import { MetricList } from "@/components/metrics/metric-list";
import { LogList } from "@/components/logs/log-list";
import { activeTabAtom } from "@/stores/telemetry";
import type { TabValue } from "@/stores/telemetry";
import { SIGNAL_LIST } from "@/lib/signals";

const tabBody: Record<TabValue, () => React.ReactElement> = {
  traces: () => <TraceList />,
  metrics: () => <MetricList />,
  logs: () => <LogList />,
};

// Tailwind scans class literals, so triggers must use pre-formed strings
// per signal. Keep this table close to App so it's obvious when a new signal
// is added.
const tabTriggerClasses: Record<TabValue, string> = {
  traces:
    "rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-trace/15 data-active:text-trace data-active:shadow-[0_0_12px_oklch(0.80_0.14_195/20%)] dark:data-active:bg-trace/15 dark:data-active:text-trace hover:text-foreground",
  metrics:
    "rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-metric/15 data-active:text-metric data-active:shadow-[0_0_12px_oklch(0.82_0.14_80/20%)] dark:data-active:bg-metric/15 dark:data-active:text-metric hover:text-foreground",
  logs: "rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-log/15 data-active:text-log data-active:shadow-[0_0_12px_oklch(0.78_0.14_300/20%)] dark:data-active:bg-log/15 dark:data-active:text-log hover:text-foreground",
};

function App() {
  useThemeSync();
  useWebSocket();
  useInitialLoad();

  const activeTab = useAtomValue(activeTabAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

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
            {SIGNAL_LIST.map((signal) => (
              <TabsTrigger
                key={signal.key}
                value={signal.key}
                className={tabTriggerClasses[signal.key]}
              >
                {signal.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {SIGNAL_LIST.map((signal) => {
          const Body = tabBody[signal.key];
          return (
            <TabsContent
              key={signal.key}
              value={signal.key}
              className="relative z-10 flex-1 overflow-hidden px-5 pb-4 pt-2"
            >
              <Body />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

export default App;
