import { useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { atom, useAtomValue } from "jotai";
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
import { metricFields, parseMetricSearch } from "@/lib/metric-search";
import { draftTerm } from "@/lib/log-filter";
import type { EventTimeWindow } from "@/lib/event-time-window";
import type { LogData, MetricData, TraceData } from "@/types/telemetry";

export function useTimeWindow() {
  const window = useSearch({
    strict: false,
    select: eventWindowFromSearch,
    structuralSharing: true,
  });
  const navigate = useNavigate();
  return [
    window,
    (value: EventTimeWindow) =>
      navigate({ to: ".", search: (previous) => ({ ...previous, ...eventWindowSearch(value) }) }),
  ] as const;
}

type Signal = "logs" | "traces" | "metrics";

function queryFields(signal: Signal) {
  return signal === "traces" ? traceFields : signal === "metrics" ? metricFields : undefined;
}

export function useSignalQuery(signal: Signal) {
  const fields = queryFields(signal);
  const state = useSearch({
    strict: false,
    select: (search) => readFilterQuery(search, fields),
    structuralSharing: true,
  });
  const actions = useSignalQueryActions(signal);
  return {
    state,
    ...actions,
    search: [state.text, ...state.filters.filter((filter) => filter.enabled).map(serializeLogTerm)]
      .filter(Boolean)
      .join(" "),
  };
}

// Commands read the current URL when invoked; consumers need no search subscription.
export function useSignalQueryActions(signal: Signal) {
  const navigate = useNavigate();
  const fields = queryFields(signal);
  const parse =
    signal === "traces"
      ? parseTraceSearch
      : signal === "metrics"
        ? parseMetricSearch
        : parseLogSearch;
  const setState = (update: SetStateAction<LogQueryState>) =>
    navigate({
      to: ".",
      search: (previous) => ({
        ...previous,
        ...filterQuerySearch(
          typeof update === "function" ? update(readFilterQuery(previous, fields)) : update,
        ),
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
  return { setState, addFilter, setText };
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
  const selectedTraceAtom = useMemo(
    () => atom((get) => get(tracesAtom).find((trace) => trace.traceId === traceId) ?? null),
    [traceId],
  );
  const trace = useAtomValue(selectedTraceAtom);
  const navigate = useNavigate();
  return {
    traceId: traceId ?? null,
    spanId: spanId ?? null,
    selectSpan: (spanId: string | null, spanTab?: "links" | "referenced-by") => {
      if (!traceId) return;
      return spanId
        ? navigate({
            to: "/traces/$traceId/spans/$spanId",
            params: { traceId, spanId },
            search: (previous) => ({
              ...previous,
              link: undefined,
              ...(spanTab ? { spanTab } : {}),
            }),
          })
        : navigate({
            to: "/traces/$traceId",
            params: { traceId },
            search: (previous) => ({ ...previous, spanTab: undefined, link: undefined }),
          });
    },
    trace,
    selectTrace: (trace: TraceData | null) =>
      trace
        ? navigate({
            to: "/traces/$traceId",
            params: { traceId: trace.traceId },
            search: (previous) => ({ ...previous, spanTab: undefined, link: undefined }),
          })
        : navigate({
            to: "/traces",
            search: (previous) => ({ ...previous, spanTab: undefined, link: undefined }),
          }),
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
  const windowSearch = () => eventWindowSearch(eventWindowFromSearch(router.state.location.search));
  return {
    navigateToTrace: (traceId: string) =>
      navigate({
        to: "/traces/$traceId",
        params: { traceId },
        search: {
          ...router.options.context.tabHistory.destinations.traces?.search,
          ...windowSearch(),
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
        search: { ...previous, ...filterQuerySearch(query), ...windowSearch() },
      });
    },
  };
}
