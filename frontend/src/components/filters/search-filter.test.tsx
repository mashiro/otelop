import { describe, it, expect, afterEach } from "vitest";
import { atom, createStore, Provider } from "jotai";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { SearchFilter } from "./search-filter";

afterEach(cleanup);

describe("SearchFilter", () => {
  it("writes typing to the atom when Enter is pressed", () => {
    const store = createStore();
    const searchAtom = atom("");
    render(
      <Provider store={store}>
        <SearchFilter atom={searchAtom} placeholder="Search…" />
      </Provider>,
    );

    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "checkout" } });

    expect(input.value).toBe("checkout");
    expect(store.get(searchAtom)).toBe("");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(store.get(searchAtom)).toBe("checkout");
  });

  it("does not search when Enter confirms an IME composition", () => {
    const store = createStore();
    const searchAtom = atom("");
    render(
      <Provider store={store}>
        <SearchFilter atom={searchAtom} placeholder="Search…" />
      </Provider>,
    );

    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "にほ" } });

    expect(input.value).toBe("にほ");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(store.get(searchAtom)).toBe("");

    fireEvent.change(input, { target: { value: "日本" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    expect(store.get(searchAtom)).toBe("日本");
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
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("checkout");

    act(() => {
      store.set(searchAtom, "");
    });

    expect(input.value).toBe("");
  });
});
