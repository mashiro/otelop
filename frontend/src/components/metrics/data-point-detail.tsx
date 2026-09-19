import { Field } from "@/components/common/detail-field";
import { KVSection } from "@/components/common/kv-section";
import { formatMetricValue } from "@/lib/format-metric";
import { formatTimestamp } from "@/lib/format";
import type { DataPoint } from "@/types/telemetry";

export function DataPointDetail({
  dp,
  resource,
  unit,
  isDistribution,
}: {
  dp: DataPoint;
  resource: Record<string, unknown>;
  unit: string;
  isDistribution: boolean;
}) {
  return (
    <>
      <div className="space-y-2.5">
        <Field label="Timestamp" value={formatTimestamp(dp.timestamp)} mono />
        <Field label="Value" mono value={formatMetricValue(dp.value, unit)} tone="metric" />
        {isDistribution && dp.count != null && (
          <Field label="Count" value={dp.count.toLocaleString()} mono />
        )}
        {isDistribution && dp.sum != null && (
          <Field label="Sum" value={formatMetricValue(dp.sum, unit)} mono />
        )}
        {isDistribution && dp.min != null && (
          <Field label="Min" value={formatMetricValue(dp.min, unit)} mono />
        )}
        {isDistribution && dp.max != null && (
          <Field label="Max" value={formatMetricValue(dp.max, unit)} mono />
        )}
      </div>

      <KVSection title="Attributes" data={dp.attributes} />
      <KVSection title="Resource" data={resource} />
    </>
  );
}
