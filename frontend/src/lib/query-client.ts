import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live deliveries drive refreshes; focusing the window must not refetch
      // every historical page or overwrite a newer WebSocket snapshot.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      gcTime: 60_000,
      // Normalized telemetry contains bigint timestamps.
      structuralSharing: false,
    },
  },
});
