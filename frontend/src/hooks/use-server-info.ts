import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";

const ServerInfoQuery = graphql(`
  query ServerInfo {
    status {
      version
      startedAt
      uptimeMs
      otlpGrpcAddr
      otlpHttpAddr
      proxyUrl
      proxyProtocol
      debug
      logLevel
      config {
        storagePath
        traceCount
        metricCount
        logCount
      }
      storage {
        fileSizeBytes
        walSizeBytes
        usedBlocks
        freeBlocks
        memoryUsageBytes
        memoryLimitBytes
        tempStorageBytes
        maxSizeBytes
        retentionMs
        tables {
          name
          rows
        }
        oldestTimestamp
        newestTimestamp
        sweepIntervalMs
        nextSweepAt
        lastSweep {
          startedAt
          durationMs
          deletedRows
          maxSizeIterations
          error
        }
      }
    }
  }
`);

// Exact row counts and timestamp bounds scan retained data, so reuse them for a minute.
const REFRESH_INTERVAL_MS = 60_000;

export function useServerInfo(open: boolean) {
  return useQuery(
    {
      queryKey: ["server-info"],
      enabled: open,
      staleTime: REFRESH_INTERVAL_MS,
      refetchInterval: open ? REFRESH_INTERVAL_MS : false,
      queryFn: () => gqlClient.request(ServerInfoQuery),
    },
    queryClient,
  );
}
