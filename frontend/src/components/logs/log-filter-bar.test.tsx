import { beforeEach, afterEach, describe, expect, it } from "vite-plus/test";
import { createStore, Provider } from "jotai";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { LogFilterBar } from "./log-filter-bar";
import { logSearchAtom, logQueryStateAtom } from "@/stores/log-query";
afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/logs"));

describe("Key / Operator / Value filters", () => {
  it.each([
    ["attributes.http.method", "GET", "POST"],
    ["trace_id", "01000000000000000000000000000000", "02000000000000000000000000000000"],
  ])("adds, edits, disables, enables, and removes %s", async (key, first, second) => {
    const store = createStore();
    render(
      <Provider store={store}>
        <LogFilterBar />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Operator")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Key"), {
      target: { value: key },
    });
    fireEvent.change(within(dialog).getByLabelText("Value"), { target: { value: first } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add filter" }));
    expect(store.get(logSearchAtom)).toBe(`${key}:${JSON.stringify(first)}`);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: `Edit filter ${key}` }));
    const edit = await screen.findByRole("dialog");
    fireEvent.change(within(edit).getByLabelText("Value"), { target: { value: second } });
    fireEvent.click(within(edit).getByRole("button", { name: "Apply changes" }));
    expect(store.get(logSearchAtom)).toBe(`${key}:${JSON.stringify(second)}`);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: `Disable filter ${key}` }));
    expect(store.get(logSearchAtom)).toBe("");
    expect(store.get(logQueryStateAtom).filters).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: `Enable filter ${key}` }));
    expect(store.get(logSearchAtom)).toBe(`${key}:${JSON.stringify(second)}`);
    fireEvent.click(screen.getByRole("button", { name: `Remove filter ${key}` }));
    expect(store.get(logQueryStateAtom).filters).toEqual([]);
  });
  it("does not add an invalid key", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <LogFilterBar />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add filter" }));
    expect(screen.getByRole("alert").textContent).toContain("attributes.key");
    expect(store.get(logQueryStateAtom).filters).toEqual([]);
  });
});

it("replaces a standard field with an attribute without retaining its old field mapping", async () => {
  const store = createStore();
  store.set(logSearchAtom, 'trace_id:"abc"');
  render(
    <Provider store={store}>
      <LogFilterBar />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit filter trace_id" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Key"), {
    target: { value: "attributes.http.method" },
  });
  fireEvent.change(within(dialog).getByLabelText("Value"), { target: { value: "GET" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
  expect(store.get(logSearchAtom)).toBe('attributes.http.method:"GET"');
  expect(store.get(logQueryStateAtom).filters[0].field).toBeUndefined();
});
