import { traceByIdOptions } from "@/hooks/use-trace-by-id";
import { tracesAtom } from "@/stores/telemetry";
import {
  type RouterHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { getDefaultStore } from "jotai";
import type { SignalKey } from "@/lib/signals";
import type { SignalSearch } from "@/lib/route-search";
import { queryClient } from "@/lib/query-client";
import { parseSearch, stringifySearch, validateSearch } from "@/lib/route-search";
import { initialLoadOptions } from "@/hooks/use-initial-load";

type SignalDestination = { search: SignalSearch } & (
  | { to: "/" | "/traces" | "/logs" | "/metrics"; params?: never }
  | { to: "/traces/$traceId"; params: { traceId: string } }
  | { to: "/traces/$traceId/spans/$spanId"; params: { traceId: string; spanId: string } }
  | { to: "/logs/$logId"; params: { logId: string } }
  | { to: "/metrics/$serviceName/$name"; params: { serviceName: string; name: string } }
);
interface RouterContext {
  store: ReturnType<typeof getDefaultStore>;
  tabHistory: {
    destinations: Partial<Record<SignalKey, SignalDestination>>;
    eventSearch: SignalSearch;
  };
}
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    signal?: SignalKey;
  }
}
function remember(context: RouterContext, signal: SignalKey, destination: SignalDestination) {
  context.tabHistory.destinations[signal] = destination;
  if (signal !== "metrics") context.tabHistory.eventSearch = destination.search;
}

export function createAppRouter(history?: RouterHistory, store = getDefaultStore()) {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: lazyRouteComponent(() => import("./App")),
    validateSearch,
    loader: () => {
      void queryClient.prefetchQuery(initialLoadOptions);
    },
  });
  const TraceList = lazyRouteComponent(() => import("./components/traces/trace-list"), "TraceList");
  const LogList = lazyRouteComponent(() => import("./components/logs/log-list"), "LogList");
  const MetricList = lazyRouteComponent(
    () => import("./components/metrics/metric-list"),
    "MetricList",
  );

  const homeRoute = createRoute({
    staticData: { signal: "traces" },
    getParentRoute: () => rootRoute,
    path: "/",
    component: TraceList,
    beforeLoad: ({ context, search, preload }) => {
      if (!preload) remember(context, "traces", { to: "/", search });
    },
  });
  const tracesRoute = createRoute({
    staticData: { signal: "traces" },
    getParentRoute: () => rootRoute,
    path: "/traces",
    component: TraceList,
    beforeLoad: ({ context, search, preload, matches }) => {
      if (!preload && matches.at(-1)?.routeId === "/traces")
        remember(context, "traces", { to: "/traces", search });
    },
  });
  const traceRoute = createRoute({
    staticData: { signal: "traces" },
    getParentRoute: () => tracesRoute,
    path: "$traceId",
    beforeLoad: ({ context, params, search, preload, matches }) => {
      if (!preload && matches.at(-1)?.routeId === "/traces/$traceId")
        remember(context, "traces", { to: "/traces/$traceId", params, search });
    },
    loader: ({ context, params }) => {
      if (!context.store.get(tracesAtom).some((trace) => trace.traceId === params.traceId)) {
        void queryClient.prefetchQuery(traceByIdOptions(params.traceId));
      }
    },
  });
  const spanRoute = createRoute({
    staticData: { signal: "traces" },
    getParentRoute: () => traceRoute,
    path: "spans/$spanId",
    beforeLoad: ({ context, params, search, preload }) => {
      if (!preload)
        remember(context, "traces", { to: "/traces/$traceId/spans/$spanId", params, search });
    },
  });
  const logsRoute = createRoute({
    staticData: { signal: "logs" },
    getParentRoute: () => rootRoute,
    path: "/logs",
    component: LogList,
    beforeLoad: ({ context, search, preload, matches }) => {
      if (!preload && matches.at(-1)?.routeId === "/logs")
        remember(context, "logs", { to: "/logs", search });
    },
  });
  const logRoute = createRoute({
    staticData: { signal: "logs" },
    getParentRoute: () => logsRoute,
    path: "$logId",
    beforeLoad: ({ context, params, search, preload }) => {
      if (!preload) remember(context, "logs", { to: "/logs/$logId", params, search });
    },
  });
  const metricsRoute = createRoute({
    staticData: { signal: "metrics" },
    getParentRoute: () => rootRoute,
    path: "/metrics",
    component: MetricList,
    beforeLoad: ({ context, search, preload, matches }) => {
      if (!preload && matches.at(-1)?.routeId === "/metrics")
        remember(context, "metrics", { to: "/metrics", search });
    },
  });
  const metricRoute = createRoute({
    staticData: { signal: "metrics" },
    getParentRoute: () => metricsRoute,
    path: "$serviceName/$name",
    beforeLoad: ({ context, params, search, preload }) => {
      if (!preload)
        remember(context, "metrics", { to: "/metrics/$serviceName/$name", params, search });
    },
  });
  const routeTree = rootRoute.addChildren([
    homeRoute,
    tracesRoute.addChildren([traceRoute.addChildren([spanRoute])]),
    logsRoute.addChildren([logRoute]),
    metricsRoute.addChildren([metricRoute]),
  ]);

  const router = createRouter({
    routeTree,
    history,
    context: { store, tabHistory: { destinations: {}, eventSearch: {} } },
    parseSearch,
    stringifySearch,
    defaultPreloadStaleTime: 0,
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
