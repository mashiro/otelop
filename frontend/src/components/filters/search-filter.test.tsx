import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { atom, createStore, Provider } from "jotai";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { SearchFilter } from "./search-filter";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SearchFilter", () => {
  it("debounces typing before writing the atom", () => {
    const store = createStore();
    const searchAtom = atom("");
    render(
      <Provider store={store}>
        <SearchFilter atom={searchAtom} placeholder="Search…" />
      </Provider>,
    );

    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "checkout" } });

    // The box updates immediately; the atom doesn't until the debounce fires.
    expect(input.value).toBe("checkout");
    expect(store.get(searchAtom)).toBe("");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(store.get(searchAtom)).toBe("checkout");
  });

  it("clearing via the X button resets both the box and the atom immediately", () => {
    const store = createStore();
    const searchAtom = atom("");
    render(
      <Provider store={store}>
        <SearchFilter atom={searchAtom} placeholder="Search…" />
      </Provider>,
    );

    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "checkout" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.click(screen.getByRole("button"));

    expect(input.value).toBe("");
    expect(store.get(searchAtom)).toBe("");
  });

  // The "Show surrounding logs" bug (components/logs/log-list.tsx clears
  // logSearchAtom from outside this component, e.g. via a "Show surrounding
  // logs" button): the box used to keep showing the stale query because its
  // local `input` state was only ever seeded once. The fix reconciles input
  // from the atom during render whenever the atom's value has diverged from
  // what this component last synced, so an external write is picked up
  // without a useEffect.
  it("reflects an external atom write into the input", () => {
    const store = createStore();
    const searchAtom = atom("");
    render(
      <Provider store={store}>
        <SearchFilter atom={searchAtom} placeholder="Search…" />
      </Provider>,
    );

    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "checkout" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(input.value).toBe("checkout");

    act(() => {
      store.set(searchAtom, "");
    });

    expect(input.value).toBe("");
  });

  it("does not clobber in-flight typing that hasn't debounced yet", () => {
    const store = createStore();
    const searchAtom = atom("initial");
    render(
      <Provider store={store}>
        <SearchFilter atom={searchAtom} placeholder="Search…" />
      </Provider>,
    );

    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    expect(input.value).toBe("initial");

    fireEvent.change(input, { target: { value: "in-progress" } });
    // The atom hasn't changed yet (debounce still pending), so a re-render
    // here must not stomp the just-typed value.
    expect(input.value).toBe("in-progress");
    expect(store.get(searchAtom)).toBe("initial");
  });
});
