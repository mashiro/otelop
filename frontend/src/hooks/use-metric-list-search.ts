import { useEffect } from "react";
import { useSetAtom, useStore } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { metricsAtom, serverMatchedMetricKeysAtom } from "@/stores/telemetry";
import { metricKeyToString } from "@/stores/navigation";

const MetricsListQuery = graphql(`
  query MetricsList($search: String) {
    metrics(limit: 0, search: $search) {
      items {
        name
        serviceName
      }
    }
  }
`);

// Drives the metrics tab's search: unlike hooks/use-initial-load.ts (which
// owns metricsAtom, the canonical buffer), this hook must NOT write
// metricsAtom itself — replacing it with the search result used to wipe out
// every metric ever seen on a zero-hit search, taking the toolbar/search box
// down with it (components/metrics/metric-list.tsx rendered EmptyState once
// metricsAtom went empty). Instead it only records which (serviceName, name)
// groups the server vouches for; stores/filters.ts's filteredMetricsAtom
// consumes that set to filter the untouched buffer.
export function useMetricListSearch(search: string): void {
  const setMatchedKeys = useSetAtom(serverMatchedMetricKeysAtom);
  const store = useStore();

  useEffect(() => {
    // An empty search shows the full buffer (see filteredMetricsAtom), and
    // hooks/use-initial-load.ts already bootstraps that buffer once at
    // mount — refetching the same unbounded list here on every metrics-tab
    // mount is redundant. Only skip when the buffer already has something to
    // show; an empty buffer (initial load still in flight, or failed) falls
    // through and fetches as a fallback.
    if (!search && store.get(metricsAtom).length > 0) return;

    let ignore = false;
    const load = async () => {
      try {
        const data = await gqlClient.request(MetricsListQuery, { search: search || undefined });
        if (ignore) return;
        setMatchedKeys(new Set(data.metrics.items.map((m) => metricKeyToString(m))));
      } catch {
        // Keep the previous result; the next search edit retries.
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [search, setMatchedKeys, store]);
}
