import { Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useThemeSync } from "@/hooks/use-theme";
import { useWebSocket } from "@/hooks/use-websocket";
import { useInitialLoad } from "@/hooks/use-initial-load";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import type { SignalKey } from "@/lib/signals";
import { eventWindowFromSearch, eventWindowSearch } from "@/lib/route-search";
import { SIGNAL_LIST } from "@/lib/signals";

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
        <TabsList variant="pill" className="shrink-0">
          {SIGNAL_LIST.map((signal) => (
            <TabsTrigger key={signal.key} value={signal.key} size="lg" tone={signal.token} glow>
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
