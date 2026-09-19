import { useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useMemo, type SetStateAction } from "react";
import { logsAtom, metricsAtom, tracesAtom } from "@/stores/telemetry";
import { eventWindowFromSearch, eventWindowSearch } from "@/lib/route-search";
import {
  readFilterQuery,
  filterQuerySearch,
  newLogFilter,
  type LogQueryState,
} from "@/lib/log-query-state";
import { parseLogSearch, serializeLogTerm, type LogSearchTerm } from "@/lib/log-search";
import { parseTraceSearch, traceFields } from "@/lib/trace-search";
import { draftTerm } from "@/lib/log-filter";
import type { EventTimeWindow } from "@/lib/event-time-window";
import type { LogData, MetricData, TraceData } from "@/types/telemetry";

export function useTimeWindow() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const window = useMemo(() => eventWindowFromSearch(search), [search]);
  return [
    window,
    (value: EventTimeWindow) =>
      navigate({ to: ".", search: (previous) => ({ ...previous, ...eventWindowSearch(value) }) }),
  ] as const;
}

export function useSignalQuery(signal: "logs" | "traces") {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const parse = signal === "traces" ? parseTraceSearch : parseLogSearch;
  const read = (value: typeof search) =>
    readFilterQuery(value, signal === "traces" ? traceFields : undefined);
  const state = useMemo(
    () => readFilterQuery(search, signal === "traces" ? traceFields : undefined),
    [search, signal],
  );
  const setState = (update: SetStateAction<LogQueryState>) =>
    navigate({
      to: ".",
      search: (previous) => ({
        ...previous,
        ...filterQuerySearch(typeof update === "function" ? update(read(previous)) : update),
      }),
    });
  const addFilter = (term: LogSearchTerm) => setState((previous) => addQueryFilter(previous, term));
  const setText = (text: string) => {
    const { plain, terms } = parse(text);
    void setState((previous) => ({
      text: plain,
      filters: [...previous.filters, ...terms.map(newLogFilter)],
    }));
    return plain;
  };
  return {
    state,
    setState,
    addFilter,
    setText,
    search: [state.text, ...state.filters.filter((filter) => filter.enabled).map(serializeLogTerm)]
      .filter(Boolean)
      .join(" "),
  };
}

function addQueryFilter(state: LogQueryState, term: LogSearchTerm): LogQueryState {
  const query = serializeLogTerm(term);
  const existing = state.filters.find((filter) => serializeLogTerm(filter) === query);
  return {
    ...state,
    filters: existing
      ? state.filters.map((filter) =>
          filter.id === existing.id ? { ...filter, enabled: true } : filter,
        )
      : [...state.filters, newLogFilter(term)],
  };
}

export function useTraceSelection() {
  const { traceId, spanId } = useParams({ strict: false });
  const traces = useAtomValue(tracesAtom);
  const navigate = useNavigate();
  return {
    traceId: traceId ?? null,
    spanId: spanId ?? null,
    selectSpan: (spanId: string | null) => {
      if (!traceId) return;
      return spanId
        ? navigate({
            to: "/traces/$traceId/spans/$spanId",
            params: { traceId, spanId },
            search: true,
          })
        : navigate({ to: "/traces/$traceId", params: { traceId }, search: true });
    },
    trace: traces.find((trace) => trace.traceId === traceId) ?? null,
    selectTrace: (trace: TraceData | null) =>
      trace
        ? navigate({ to: "/traces/$traceId", params: { traceId: trace.traceId }, search: true })
        : navigate({ to: "/traces", search: true }),
  };
}
export function useMetricSelection() {
  const { serviceName, name } = useParams({ strict: false });
  const metrics = useAtomValue(metricsAtom);
  const navigate = useNavigate();
  return {
    metric:
      metrics.find((metric) => metric.serviceName === serviceName && metric.name === name) ?? null,
    selectMetric: (metric: MetricData | null) =>
      metric
        ? navigate({
            to: "/metrics/$serviceName/$name",
            params: { serviceName: metric.serviceName, name: metric.name },
            search: true,
          })
        : navigate({ to: "/metrics", search: true }),
  };
}
export function useLogSelection() {
  const { logId } = useParams({ strict: false });
  const logs = useAtomValue(logsAtom);
  const navigate = useNavigate();
  return {
    log: logs.find((log) => log.id === logId) ?? null,
    selectLog: (log: LogData | null) =>
      log
        ? navigate({ to: "/logs/$logId", params: { logId: log.id }, search: true })
        : navigate({ to: "/logs", search: true }),
    showSurroundingLogs: (window: EventTimeWindow) =>
      navigate({ to: ".", search: eventWindowSearch(window) }),
  };
}
export function useRelatedSignals() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ strict: false });
  const windowSearch = eventWindowSearch(eventWindowFromSearch(search));
  return {
    navigateToTrace: (traceId: string) =>
      navigate({
        to: "/traces/$traceId",
        params: { traceId },
        search: {
          ...router.options.context.tabHistory.destinations.traces?.search,
          ...windowSearch,
        },
      }),
    navigateToLogs: (traceId: string) => {
      const previous = router.options.context.tabHistory.destinations.logs?.search ?? {};
      const query = addQueryFilter(
        readFilterQuery(previous),
        draftTerm({ key: "trace_id", operator: "is", value: traceId }),
      );
      return navigate({
        to: "/logs",
        search: { ...previous, ...filterQuerySearch(query), ...windowSearch },
      });
    },
  };
}
