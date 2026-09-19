import { Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useThemeSync } from "@/hooks/use-theme";
import { useWebSocket } from "@/hooks/use-websocket";
import { useInitialLoad } from "@/hooks/use-initial-load";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import type { SignalKey } from "@/lib/signals";
import { eventWindowFromSearch, eventWindowSearch } from "@/lib/route-search";
import { SIGNAL_LIST } from "@/lib/signals";

// Tailwind scans class literals, so triggers must use pre-formed strings
// per signal. Keep this table close to App so it's obvious when a new signal
// is added.
const tabTriggerClasses: Record<SignalKey, string> = {
  traces:
    "rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-trace/15 data-active:text-trace data-active:shadow-[0_0_12px_oklch(0.80_0.14_195/20%)] dark:data-active:bg-trace/15 dark:data-active:text-trace hover:text-foreground",
  metrics:
    "rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-metric/15 data-active:text-metric data-active:shadow-[0_0_12px_oklch(0.82_0.14_80/20%)] dark:data-active:bg-metric/15 dark:data-active:text-metric hover:text-foreground",
  logs: "rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all data-active:bg-log/15 data-active:text-log data-active:shadow-[0_0_12px_oklch(0.78_0.14_300/20%)] dark:data-active:bg-log/15 dark:data-active:text-log hover:text-foreground",
};

function App() {
  const router = useRouter();
  const navigate = useNavigate();
  useThemeSync();
  useWebSocket((traceId) => {
    if (router.matchRoute({ to: "/traces/$traceId", params: { traceId } })) {
      void navigate({ to: "/traces", search: true });
    }
  });
  useInitialLoad();

  const activeTab = useRouterState({
    select: (state) => state.matches.at(-1)?.staticData.signal ?? "traces",
  });
  const setActiveTab = (tab: SignalKey) => {
    const { destinations, eventSearch } = router.options.context.tabHistory;
    const destination = destinations[tab] ?? { to: `/${tab}` as const, search: {} };
    void navigate({
      ...destination,
      search: {
        ...destination.search,
        ...(tab === "metrics" ? {} : eventWindowSearch(eventWindowFromSearch(eventSearch))),
      },
    });
  };

  return (
    <div className="noise-bg mesh-bg flex h-screen flex-col text-foreground">
      <Header />
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as SignalKey)}
        className="flex flex-1 flex-col gap-3 overflow-hidden px-5 pb-4 pt-3"
      >
        <TabsList className="w-fit shrink-0 gap-1 bg-transparent p-0">
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
        <TabsContent
          value={activeTab}
          className="relative z-10 flex flex-1 flex-col overflow-hidden"
        >
          <Outlet />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default App;
