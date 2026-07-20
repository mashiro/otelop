import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { setMetricsAtom, setTotalCountsAtom, renderWindowMaxAtom } from "@/stores/telemetry";
import { normalizeMetric } from "@/lib/normalize";
import type { MetricData } from "@/types/telemetry";

// Ring-buffer capacity config (traceCap/metricCap/logCap/maxDataPoints) was
// removed from the backend's Config type when storage moved to DuckDB with
// time-based retention (docs/design/duckdb-storage.md). The client-side caps
// that used to come from that query stay as fixed defaults in
// stores/telemetry.ts (DEFAULT_CONFIG) bounding this tab's live buffer;
// history beyond them is queryable from the server (see
// hooks/use-metric-range-points.ts).
//
// Traces and logs used to bootstrap here too (alongside metrics, in one
// combined query), both via an unbounded `limit: 0` fetch — the ring-buffer-
// era design issue #160 replaced with server-side pagination scoped to the
// tab's selected time range (see hooks/use-trace-list-page.ts,
// hooks/use-log-list-page.ts, mounted from the traces/logs tabs
// themselves). Metrics still bootstrap unbounded here (`limit: 0`, every
// group), but no longer with dataPoints (issue #162): a metrics list of ~40
// groups was paying ~39 Metric.dataPoints resolutions — each re-deriving a
// whole retained series — just to render list rows the detail view (which
// fetches its own points on demand, see hooks/use-metric-range-points.ts)
// doesn't need populated. pointCount/latestValue are cheap, purpose-built
// summary fields for exactly what the list renders (see MetricList).
//
// config { traceCount metricCount logCount } feeds the header badges (see
// stores/telemetry.ts's totalTraceCountAtom/totalMetricCountAtom/
// totalLogCountAtom) — the server-side row/group totals, since the
// traces/logs tabs' own paginated fetch only ever loads a page at a time.
//
// config { renderWindowMax } is the backend's --render-window-max/
// OTELOP_RENDER_WINDOW_MAX/config.toml [ui] setting (internal/config/config.go),
// seeded into stores/telemetry.ts's renderWindowMaxAtom below so the
// traces/metrics/logs tables' mounted-row cap (hooks/use-render-window.ts) is
// operator-configurable instead of a frontend-only constant.
const InitialLoadQuery = graphql(`
  query InitialLoad {
    config {
      traceCount
      metricCount
      logCount
      renderWindowMax
    }
    metrics(limit: 0) {
      items {
        name
        description
        unit
        type
        serviceName
        resource
        receivedAt
        pointCount
        latestValue
      }
    }
  }
`);

export function useInitialLoad() {
  const setMetrics = useSetAtom(setMetricsAtom);
  const setTotalCounts = useSetAtom(setTotalCountsAtom);
  const setRenderWindowMax = useSetAtom(renderWindowMaxAtom);
  // StrictMode double-invokes effects in dev; guard so the bootstrap fetch
  // (and its Jotai writes) only runs once per real mount.
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const load = async () => {
      try {
        const data = await gqlClient.request(InitialLoadQuery);
        setTotalCounts(data.config);
        setRenderWindowMax(data.config.renderWindowMax);
        // dataPoints wasn't selected above (see this file's doc comment);
        // every metric enters the buffer empty and fills in lazily — via a
        // detail view's use-metric-range-points fetch, or a WS delivery
        // merging in through addMetricAtom.
        const metrics: MetricData[] = data.metrics.items.map((m) =>
          normalizeMetric({ ...m, dataPoints: [] }),
        );
        setMetrics(metrics);
      } catch {
        // WebSocket will deliver data later.
      }
    };
    void load();
  }, [setMetrics, setTotalCounts, setRenderWindowMax]);
}
