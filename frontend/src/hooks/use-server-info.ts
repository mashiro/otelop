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
      httpAddr
      otlpGrpcAddr
      otlpHttpAddr
      proxyUrl
      proxyProtocol
      debug
      logLevel
      config {
        storagePath
        retention
        maxSize
        traceCount
        metricCount
        logCount
      }
      storage {
        fileSizeBytes
        walSizeBytes
        databaseSizeBytes
        totalBlocks
        usedBlocks
        freeBlocks
        memoryUsageBytes
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

const REFRESH_INTERVAL_MS = 5_000;

export function useServerInfo(open: boolean) {
  return useQuery(
    {
      queryKey: ["server-info"],
      enabled: open,
      refetchInterval: open ? REFRESH_INTERVAL_MS : false,
      queryFn: () => gqlClient.request(ServerInfoQuery),
    },
    queryClient,
  );
}
