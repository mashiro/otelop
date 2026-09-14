import type { MetricData } from "@/types/telemetry";

export type MetricKey = Pick<MetricData, "serviceName" | "name">;

export function metricKeyToString(key: MetricKey): string {
  return JSON.stringify([key.serviceName ?? "", key.name]);
}
