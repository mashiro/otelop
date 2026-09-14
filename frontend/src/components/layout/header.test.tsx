import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { Header } from "./header";
import {
  activeTabAtom,
  applyLocationAtom,
  eventTimeWindowAtom,
  selectedTraceIdAtom,
  traceQueryStateAtom,
  useLocationSync,
} from "@/stores/navigation";
import { wsStatusAtom } from "@/stores/telemetry";

afterEach(cleanup);

function LocationSync() {
  useLocationSync();
  return null;
}

function setup() {
  const store = createStore();
  const path = "/traces/example?range=6h&q=checkout";
  window.history.replaceState(null, "", path);
  store.set(applyLocationAtom, path);
  store.set(wsStatusAtom, "connected");
  render(
    <Provider store={store}>
      <LocationSync />
      <Header />
    </Provider>,
  );
  return { store, path, link: screen.getByRole("link", { name: "otelop" }) };
}

describe("header home link", () => {
  it("navigates home without native navigation and restores the previous URL state", () => {
    const { store, path, link } = setup();
    const historyLength = window.history.length;
    expect(fireEvent.click(link)).toBe(false);
    expect(window.location.pathname + window.location.search).toBe("/");
    expect(store.get(activeTabAtom)).toBe("traces");
    expect(store.get(selectedTraceIdAtom)).toBeNull();
    expect(store.get(traceQueryStateAtom)).toEqual({ text: "", filters: [] });
    expect(store.get(eventTimeWindowAtom)).toEqual({ mode: "live", range: "1h" });
    expect(store.get(wsStatusAtom)).toBe("connected");
    expect(window.history.length).toBe(historyLength + 1);
    fireEvent.click(link);
    expect(window.history.length).toBe(historyLength + 1);

    window.history.replaceState(null, "", path);
    fireEvent.popState(window);
    expect(store.get(selectedTraceIdAtom)).toBe("example");
    expect(store.get(traceQueryStateAtom).text).toBe("checkout");
    expect(store.get(eventTimeWindowAtom)).toEqual({ mode: "live", range: "6h" });
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"])(
    "preserves native link behavior with %s",
    (modifier) => {
      const { store, link } = setup();
      expect(link.getAttribute("href")).toBe("/");
      expect(fireEvent.click(link, { [modifier]: true })).toBe(true);
      expect(store.get(selectedTraceIdAtom)).toBe("example");
    },
  );
});
