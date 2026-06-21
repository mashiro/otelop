import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import { metricsAtom, addMetricAtom, serverConfigAtom } from "./telemetry";
import { makeMetric, makeDataPoint } from "@/test/factories";

describe("addMetricAtom", () => {
  it("merges data points by id, dropping re-delivered duplicates", () => {
    const store = createStore();
    const a = makeDataPoint({ id: "a" });
    const b = makeDataPoint({ id: "b" });
    store.set(metricsAtom, [makeMetric({ name: "m", dataPoints: [a, b] })]);

    // The WebSocket re-sends the metric's full accumulated points (a, b) plus a
    // new one (c); a and b must not be duplicated.
    const c = makeDataPoint({ id: "c" });
    store.set(addMetricAtom, makeMetric({ name: "m", dataPoints: [a, b, c] }));

    const points = store.get(metricsAtom)[0].dataPoints;
    expect(points.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("appends genuinely new points", () => {
    const store = createStore();
    store.set(metricsAtom, [makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "a" })] })]);

    store.set(addMetricAtom, makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "b" })] }));

    expect(store.get(metricsAtom)[0].dataPoints.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("keeps only the newest maxDataPoints after merging", () => {
    const store = createStore();
    store.set(serverConfigAtom, { ...store.get(serverConfigAtom), maxDataPoints: 2 });
    store.set(metricsAtom, [makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "a" })] })]);

    store.set(
      addMetricAtom,
      makeMetric({
        name: "m",
        dataPoints: [makeDataPoint({ id: "b" }), makeDataPoint({ id: "c" })],
      }),
    );

    expect(store.get(metricsAtom)[0].dataPoints.map((p) => p.id)).toEqual(["b", "c"]);
  });
});
