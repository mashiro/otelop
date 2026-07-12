import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { setMetricsAtom } from "@/stores/telemetry";
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

type MetricListItem = MetricData;

function toMetricData(items: Omit<MetricListItem, "dataPoints">[]): MetricData[] {
  return items.map((metric) => ({ ...metric, dataPoints: [] }));
}

export function useMetricListSearch(search: string): void {
  const setMetrics = useSetAtom(setMetricsAtom);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const data = await gqlClient.request(MetricsListQuery, { search: search || undefined });
        if (ignore) return;
        setMetrics(toMetricData(data.metrics.items));
      } catch {
        // Keep the previous result; the next search edit retries.
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [search, setMetrics]);
}
