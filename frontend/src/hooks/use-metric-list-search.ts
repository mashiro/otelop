import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { metricSearchResultAtom } from "@/stores/telemetry";
import { normalizeMetric } from "@/lib/normalize";
import type { MetricData } from "@/types/telemetry";

const MetricsListQuery = graphql(`
  query MetricsList($search: String) {
    metrics(limit: 0, search: $search) {
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

// Drives the metrics tab's search: unlike hooks/use-initial-load.ts (which
// owns metricsAtom, the canonical buffer), this hook must NOT write
// metricsAtom itself — replacing it with the search result used to wipe out
// every metric ever seen on a zero-hit search, taking the toolbar/search box
// down with it (components/metrics/metric-list.tsx rendered EmptyState once
// metricsAtom went empty). Instead it only records which (serviceName, name)
// matching summaries separately; stores/filters.ts combines them with the
// untouched live buffer.
export function useMetricListSearch(search: string): void {
  const setSearchResult = useSetAtom(metricSearchResultAtom);

  const { data } = useQuery(
    {
      queryKey: ["metric-search", search],
      queryFn: () => gqlClient.request(MetricsListQuery, { search }),
      enabled: Boolean(search),
    },
    queryClient,
  );
  useEffect(() => {
    if (!data || !search) return;
    const items: MetricData[] = data.metrics.items.map((m) =>
      normalizeMetric({ ...m, dataPoints: [] }),
    );
    setSearchResult({ search, items });
  }, [data, search, setSearchResult]);
}
