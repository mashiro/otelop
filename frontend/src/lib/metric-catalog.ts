// Well-known metric catalog, sourced from OpenTelemetry semantic conventions.
// github.com/open-telemetry/semantic-conventions/model/*/metrics.yaml
//
// The catalog has two roles:
//
//   1. Curate multi-attribute facet TUPLES that are commonly used together on
//      dashboards (e.g. Method + Route). Single-attribute facets are NOT
//      listed here — they are auto-discovered from the data using the
//      cardinality rules in `resolveMetricFacets`.
//
//   2. Provide canonical units for well-known metrics so charts can render
//      readable axes even when an exporter ships without a unit string.
//
// Rules are scanned in order and the first prefix match wins, so exact
// metric names must come before broader domain prefixes.

// Metric types that carry a per-window observation distribution
// (count/sum/min/max) in addition to the primary Value scalar. Matches the
// enum string Go emits from pmetric.MetricType.String().
export const DISTRIBUTION_METRIC_TYPES = new Set(["Histogram", "Summary", "ExponentialHistogram"]);

export function isDistributionMetric(type: string): boolean {
  return DISTRIBUTION_METRIC_TYPES.has(type);
}

export interface MetricFacet {
  // One or more attributes whose values are joined to form the series key.
  attributes: string[];
  // Display label shown on the facet tab (e.g. "Method + Route").
  label: string;
}

export interface MetricRule {
  pattern: string;
  unit?: string;
  keys?: MetricFacet[];
}

// Friendly labels for well-known OTel attributes, used when an attribute is
// rendered as a standalone facet tab (either discovered from data or part of
// a catalog tuple). Unknown attributes fall back to their raw name.
export const ATTRIBUTE_LABELS: Record<string, string> = {
  // HTTP
  "http.request.method": "Method",
  "http.route": "Route",
  "http.response.status_code": "Status",
  "server.address": "Host",
  "server.port": "Port",
  "url.scheme": "Scheme",

  // Database
  "db.operation.name": "Operation",
  "db.collection.name": "Collection",
  "db.namespace": "Namespace",
  "db.system.name": "System",
  "db.client.connection.pool.name": "Pool",
  "db.client.connection.state": "State",

  // RPC
  "rpc.service": "Service",
  "rpc.method": "Method",

  // Messaging
  "messaging.destination.name": "Destination",
  "messaging.system": "System",
  "messaging.operation.name": "Operation",

  // GenAI
  "gen_ai.operation.name": "Operation",
  "gen_ai.request.model": "Model",
  "gen_ai.token.type": "Token Type",

  // FaaS
  "faas.trigger": "Trigger",

  // JVM
  "jvm.memory.pool.name": "Pool",
  "jvm.memory.type": "Type",
  "jvm.gc.name": "GC",
  "jvm.gc.action": "Action",
  "jvm.thread.state": "State",
  "jvm.thread.daemon": "Daemon",

  // System / process / container / k8s
  "cpu.mode": "Mode",
  "system.cpu.logical_number": "CPU",
  "system.memory.state": "State",
  "system.paging.state": "State",
  "system.filesystem.state": "State",
  "system.device": "Device",
  "network.io.direction": "Direction",
  "disk.io.direction": "Direction",
  "k8s.namespace.name": "Namespace",
  "k8s.pod.name": "Pod",
  "k8s.container.name": "Container",
  "k8s.node.name": "Node",

  // Runtimes
  "go.memory.type": "Type",

  // .NET
  "aspnetcore.routing.match_status": "Status",

  // OTel SDK self-telemetry
  "otel.component.type": "Exporter",
};

export const METRIC_RULES: MetricRule[] = [
  // HTTP server
  {
    pattern: "http.server.request.duration",
    unit: "s",
    keys: [{ attributes: ["http.request.method", "http.route"], label: "Method + Route" }],
  },
  {
    pattern: "http.server.request.body.size",
    unit: "By",
    keys: [{ attributes: ["http.request.method", "http.route"], label: "Method + Route" }],
  },
  {
    pattern: "http.server.response.body.size",
    unit: "By",
    keys: [{ attributes: ["http.request.method", "http.route"], label: "Method + Route" }],
  },
  {
    pattern: "http.server.active_requests",
    keys: [{ attributes: ["http.request.method", "http.route"], label: "Method + Route" }],
  },
  {
    pattern: "http.server.",
    keys: [{ attributes: ["http.request.method", "http.route"], label: "Method + Route" }],
  },

  // HTTP client
  {
    pattern: "http.client.request.duration",
    unit: "s",
    keys: [{ attributes: ["http.request.method", "server.address"], label: "Method + Host" }],
  },
  { pattern: "http.client.request.body.size", unit: "By" },
  { pattern: "http.client.response.body.size", unit: "By" },
  { pattern: "http.client.", unit: "s" },

  // Database
  {
    pattern: "db.client.operation.duration",
    unit: "s",
    keys: [
      {
        attributes: ["db.operation.name", "db.collection.name"],
        label: "Operation + Collection",
      },
    ],
  },
  { pattern: "db.client.connection." },

  // RPC
  {
    pattern: "rpc.server.call.duration",
    unit: "s",
    keys: [{ attributes: ["rpc.service", "rpc.method"], label: "Service + Method" }],
  },
  {
    pattern: "rpc.client.call.duration",
    unit: "s",
    keys: [{ attributes: ["rpc.service", "rpc.method"], label: "Service + Method" }],
  },

  // Messaging
  {
    pattern: "messaging.client.operation.duration",
    unit: "s",
    keys: [
      {
        attributes: ["messaging.operation.name", "messaging.destination.name"],
        label: "Operation + Destination",
      },
    ],
  },
  { pattern: "messaging.process.duration", unit: "s" },
  { pattern: "messaging.client.sent.messages" },
  { pattern: "messaging.client.consumed.messages" },

  // GenAI
  {
    pattern: "gen_ai.client.operation.duration",
    unit: "s",
    keys: [
      {
        attributes: ["gen_ai.operation.name", "gen_ai.request.model"],
        label: "Operation + Model",
      },
    ],
  },
  {
    pattern: "gen_ai.client.token.usage",
    unit: "{token}",
    keys: [
      {
        attributes: ["gen_ai.token.type", "gen_ai.request.model"],
        label: "Token Type + Model",
      },
    ],
  },
  {
    pattern: "gen_ai.server.request.duration",
    unit: "s",
    keys: [
      {
        attributes: ["gen_ai.operation.name", "gen_ai.request.model"],
        label: "Operation + Model",
      },
    ],
  },

  // FaaS
  { pattern: "faas.invoke_duration", unit: "s" },
  { pattern: "faas.init_duration", unit: "s" },
  { pattern: "faas.invocations" },
  { pattern: "faas.errors" },

  // JVM
  { pattern: "jvm.memory.used", unit: "By" },
  { pattern: "jvm.memory.committed", unit: "By" },
  { pattern: "jvm.memory.limit", unit: "By" },
  {
    pattern: "jvm.gc.duration",
    unit: "s",
    keys: [{ attributes: ["jvm.gc.name", "jvm.gc.action"], label: "GC + Action" }],
  },
  { pattern: "jvm.thread.count" },
  { pattern: "jvm.cpu.time", unit: "s" },

  // Node.js
  { pattern: "nodejs.eventloop.utilization", unit: "1" },
  { pattern: "nodejs.eventloop.time", unit: "s" },

  // Go
  { pattern: "go.memory.used", unit: "By" },
  { pattern: "go.memory.allocated", unit: "By" },
  { pattern: "go.schedule.duration", unit: "s" },

  // .NET
  { pattern: "dotnet.gc.pause.time", unit: "s" },
  { pattern: "dotnet.process.memory.working_set", unit: "By" },
  { pattern: "dotnet.jit.compilation.time", unit: "s" },
  { pattern: "aspnetcore.routing.match_attempts" },

  // System
  {
    pattern: "system.cpu.utilization",
    unit: "1",
    keys: [
      {
        attributes: ["system.cpu.logical_number", "cpu.mode"],
        label: "CPU + Mode",
      },
    ],
  },
  { pattern: "system.cpu.time", unit: "s" },
  { pattern: "system.memory.usage", unit: "By" },
  { pattern: "system.memory.utilization", unit: "1" },
  {
    pattern: "system.network.io",
    unit: "By",
    keys: [
      {
        attributes: ["network.io.direction", "system.device"],
        label: "Direction + Device",
      },
    ],
  },
  {
    pattern: "system.disk.io",
    unit: "By",
    keys: [
      {
        attributes: ["disk.io.direction", "system.device"],
        label: "Direction + Device",
      },
    ],
  },
  {
    pattern: "system.filesystem.usage",
    unit: "By",
    keys: [
      {
        attributes: ["system.device", "system.filesystem.state"],
        label: "Device + State",
      },
    ],
  },

  // Process
  { pattern: "process.cpu.time", unit: "s" },
  { pattern: "process.cpu.utilization", unit: "1" },
  { pattern: "process.memory.usage", unit: "By" },
  { pattern: "process.network.io", unit: "By" },
  { pattern: "process.disk.io", unit: "By" },

  // Container
  { pattern: "container.cpu.time", unit: "s" },
  { pattern: "container.memory.usage", unit: "By" },
  { pattern: "container.network.io", unit: "By" },

  // Kubernetes
  {
    pattern: "k8s.pod.memory.usage",
    unit: "By",
    keys: [
      {
        attributes: ["k8s.namespace.name", "k8s.pod.name"],
        label: "Namespace + Pod",
      },
    ],
  },
  {
    pattern: "k8s.pod.cpu.usage",
    keys: [
      {
        attributes: ["k8s.namespace.name", "k8s.pod.name"],
        label: "Namespace + Pod",
      },
    ],
  },
  {
    pattern: "k8s.container.cpu.limit",
    keys: [{ attributes: ["k8s.pod.name", "k8s.container.name"], label: "Pod + Container" }],
  },
  { pattern: "k8s.node.memory.usage", unit: "By" },

  // OTel SDK self-telemetry
  { pattern: "otel.sdk.exporter.operation.duration", unit: "s" },
];

export function lookupMetricRule(name: string): MetricRule | undefined {
  for (const rule of METRIC_RULES) {
    if (name.startsWith(rule.pattern)) return rule;
  }
  return undefined;
}

export function resolveMetricUnit(name: string, declaredUnit: string): string {
  if (declaredUnit) return declaredUnit;
  return lookupMetricRule(name)?.unit ?? "";
}

// Cardinality window for auto-discovered single-attribute facets.
// Below DISCOVERED_FACET_MIN (i.e. constant) → not useful to facet by.
// Above DISCOVERED_FACET_MAX (high-cardinality identifier) → too noisy to
// render as a picker; would also blow up the chart.
const DISCOVERED_FACET_MIN = 2;
const DISCOVERED_FACET_MAX = 20;

// Build the ordered facet list for a metric:
//
//   1. Catalog tuples first (curated multi-attribute combinations), filtered
//      by whether every attribute in the tuple appears in the data.
//   2. Discovered single-attribute facets next, with cardinality in the
//      [MIN, MAX] window, sorted by attribute name. Labels come from
//      ATTRIBUTE_LABELS when known, otherwise the raw attribute name.
export function resolveMetricFacets(
  name: string,
  attributeCardinality: Map<string, number>,
): MetricFacet[] {
  const result: MetricFacet[] = [];

  const rule = lookupMetricRule(name);
  if (rule?.keys) {
    for (const f of rule.keys) {
      if (f.attributes.every((a) => attributeCardinality.has(a))) {
        result.push(f);
      }
    }
  }

  const sorted = [...attributeCardinality].sort(([a], [b]) => a.localeCompare(b));
  for (const [attr, count] of sorted) {
    if (count < DISCOVERED_FACET_MIN || count > DISCOVERED_FACET_MAX) continue;
    result.push({
      attributes: [attr],
      label: ATTRIBUTE_LABELS[attr] ?? attr,
    });
  }

  return result;
}

// Stable string id for a facet, usable as a tab value.
export function facetId(facet: MetricFacet): string {
  return facet.attributes.join("|");
}
