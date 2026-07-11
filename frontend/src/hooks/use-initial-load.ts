import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { setMetricsAtom } from "@/stores/telemetry";

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
// themselves). Metrics still bootstrap unbounded here; scoping the metrics
// tab's initial load the same way is a separate follow-up (#162).
const InitialLoadQuery = graphql(`
  query InitialLoad {
    metrics(limit: 0) {
      items {
        name
        description
        unit
        type
        serviceName
        resource
        receivedAt
        dataPoints {
          id
          timestamp
          value
          cumulative
          count
          countCumulative
          sum
          sumCumulative
          min
          max
          attributes
        }
      }
    }
  }
`);

export function useInitialLoad() {
  const setMetrics = useSetAtom(setMetricsAtom);
  // StrictMode double-invokes effects in dev; guard so the bootstrap fetch
  // (and its Jotai writes) only runs once per real mount.
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const load = async () => {
      try {
        const data = await gqlClient.request(InitialLoadQuery);
        setMetrics(data.metrics.items);
      } catch {
        // WebSocket will deliver data later.
      }
    };
    void load();
  }, [setMetrics]);
}
