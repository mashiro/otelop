import { traceByIdOptions } from "@/hooks/use-trace-by-id";
import { selectedTraceAtom } from "@/stores/telemetry";
import { configureNavigation } from "@/lib/navigation-driver";
import {
  type RouterHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { getDefaultStore } from "jotai";
import { applyLocationAtom } from "@/stores/navigation";
import { queryClient } from "@/lib/query-client";
import { parseSearch, stringifySearch, validateSearch } from "@/lib/route-search";
import { initialLoadOptions } from "@/hooks/use-initial-load";

const rootRoute = createRootRoute({
  component: lazyRouteComponent(() => import("./App")),
  validateSearch,
  beforeLoad: ({ location, preload }) => {
    // Preloading a link must not change the currently displayed signal.
    if (!preload) getDefaultStore().set(applyLocationAtom, location.href);
  },
  loader: () => {
    void queryClient.prefetchQuery(initialLoadOptions);
  },
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./components/traces/trace-list"), "TraceList"),
});
const tracesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "traces",
  component: lazyRouteComponent(() => import("./components/traces/trace-list"), "TraceList"),
});
const traceRoute = createRoute({
  getParentRoute: () => tracesRoute,
  path: "$traceId",
  loader: ({ params }) => {
    if (getDefaultStore().get(selectedTraceAtom)?.traceId !== params.traceId) {
      void queryClient.prefetchQuery(traceByIdOptions(params.traceId));
    }
  },
});
const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "logs",
  component: lazyRouteComponent(() => import("./components/logs/log-list"), "LogList"),
});
const logRoute = createRoute({ getParentRoute: () => logsRoute, path: "$logId" });
const metricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "metrics",
  component: lazyRouteComponent(() => import("./components/metrics/metric-list"), "MetricList"),
});
const metricRoute = createRoute({ getParentRoute: () => metricsRoute, path: "$serviceName/$name" });

const routeTree = rootRoute.addChildren([
  homeRoute,
  tracesRoute.addChildren([traceRoute]),
  logsRoute.addChildren([logRoute]),
  metricsRoute.addChildren([metricRoute]),
]);

export function createAppRouter(history?: RouterHistory) {
  const router = createRouter({
    routeTree,
    history,
    parseSearch,
    stringifySearch,
    defaultPreloadStaleTime: 0,
  });

  configureNavigation((href) => {
    void router.navigate({ href });
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
