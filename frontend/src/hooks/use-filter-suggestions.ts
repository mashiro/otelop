import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
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
  const { data, isPending, isError } = useQuery(
    {
      queryKey: ["filter-suggestions", requestKey],
      enabled,
      queryFn: async ({ signal: abortSignal }) => {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(abortSignal.reason);
          };
          const timer = setTimeout(() => {
            abortSignal.removeEventListener("abort", abort);
            resolve();
          }, 200);
          abortSignal.addEventListener("abort", abort, { once: true });
        });
        const data = await gqlClient.request({
          document: FilterSuggestionsQuery,
          variables: { signal, key, input, ...eventWindowBounds(window) },
          signal: abortSignal,
        });
        return data.filterSuggestions;
      },
    },
    queryClient,
  );
  return {
    items: enabled ? (data ?? []) : [],
    loading: enabled && isPending,
    error: enabled && isError,
  };
}
