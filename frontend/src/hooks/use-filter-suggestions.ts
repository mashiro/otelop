import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { eventTimeWindowAtom } from "@/stores/navigation";
import { eventWindowBounds, eventWindowKey } from "@/lib/event-time-window";

const FilterSuggestionsQuery = graphql(`
  query FilterSuggestions($signal: String!, $key: String, $input: String!, $from: Time, $to: Time) {
    filterSuggestions(signal: $signal, key: $key, input: $input, from: $from, to: $to)
  }
`);

export function useFilterSuggestions(
  signal: "logs" | "traces",
  key: string | undefined,
  input: string,
  enabled = true,
) {
  const window = useAtomValue(eventTimeWindowAtom);
  const requestKey = JSON.stringify([signal, key, input, eventWindowKey(window), enabled]);
  const [result, setResult] = useState<{
    requestKey: string;
    items: string[];
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await gqlClient.request({
          document: FilterSuggestionsQuery,
          variables: { signal, key, input, ...eventWindowBounds(window) },
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setResult({ requestKey, items: data.filterSuggestions, error: false });
      } catch {
        if (!controller.signal.aborted) setResult({ requestKey, items: [], error: true });
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey]);
  const current = result?.requestKey === requestKey ? result : null;
  return {
    items: enabled ? (current?.items ?? []) : [],
    loading: enabled && !current,
    error: enabled && !!current?.error,
  };
}
