import { useEffect, useEffectEvent } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { wsManager } from "@/lib/websocket-manager";
import type { WsMessage } from "@/types/telemetry";
import type { WsStatus } from "@/stores/telemetry";

// Database reconciliation also covers missed notifications and retention sweeps.
export const telemetryRefreshOptions = {
  staleTime: 0,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
};

export function useTelemetryQueryUpdates(
  queryKey: QueryKey,
  relevant: (message: WsMessage) => boolean,
) {
  const key = JSON.stringify(queryKey);
  const isRelevant = useEffectEvent(relevant);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = undefined;
      void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as QueryKey });
    };
    let previousStatus: WsStatus | undefined;
    const unsubscribe = wsManager.subscribe({
      onStatus: (status) => {
        if (
          status === "connected" &&
          previousStatus !== undefined &&
          previousStatus !== "connected"
        )
          refresh();
        previousStatus = status;
      },
      onMessage: (message) => {
        if (!isRelevant(message) || timer) return;
        timer = setTimeout(refresh, 1000);
      },
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [key]);
}
