import { beforeEach, afterEach, describe, expect, it } from "vite-plus/test";
import { createStore, Provider } from "jotai";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { LogFilterBar } from "./log-filter-bar";
import { LOG_QUERY_STORAGE_KEY, logSearchAtom, logQueryStateAtom } from "@/stores/log-query";
afterEach(cleanup);
beforeEach(() => window.localStorage.removeItem(LOG_QUERY_STORAGE_KEY));

describe("Key / Operator / Value filters", () => {
  it("adds, edits, disables, enables, and removes a condition", async () => {
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
      target: { value: "attributes.http.method" },
    });
    fireEvent.change(within(dialog).getByLabelText("Value"), { target: { value: "GET" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add filter" }));
    expect(store.get(logSearchAtom)).toBe('attributes.http.method:"GET"');
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Edit filter attributes.http.method" }));
    const edit = await screen.findByRole("dialog");
    fireEvent.change(within(edit).getByLabelText("Value"), { target: { value: "POST" } });
    fireEvent.click(within(edit).getByRole("button", { name: "Apply changes" }));
    expect(store.get(logSearchAtom)).toBe('attributes.http.method:"POST"');
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Disable filter attributes.http.method" }));
    expect(store.get(logSearchAtom)).toBe("");
    expect(store.get(logQueryStateAtom).filters).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Enable filter attributes.http.method" }));
    expect(store.get(logSearchAtom)).toBe('attributes.http.method:"POST"');
    fireEvent.click(screen.getByRole("button", { name: "Remove filter attributes.http.method" }));
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
