import { beforeEach, afterEach, describe, expect, it } from "vite-plus/test";
import { createStore } from "jotai";
import { act, render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { LogFilterBar } from "./log-filter-bar";
import { createTestRouter } from "@/test/router";
import { readFilterQuery } from "@/lib/log-query-state";
afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/logs"));

describe("Key / Operator / Value filters", () => {
  it.each([
    ["attributes.http.method", "GET", "POST"],
    ["trace_id", "01000000000000000000000000000000", "02000000000000000000000000000000"],
  ])("adds, edits, disables, enables, and removes %s", async (key, first, second) => {
    const store = createStore();
    const { router, wrapper } = await createTestRouter("/logs", store);
    render(<LogFilterBar />, { wrapper });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Operator")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Key"), {
      target: { value: key },
    });
    fireEvent.change(within(dialog).getByLabelText("Value"), { target: { value: first } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add filter" }));
    });
    expect((router.state.location.search.filter ?? []).join(" ")).toBe(
      `${key}:${JSON.stringify(first)}`,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Edit filter ${key}` }));
    });
    const edit = await screen.findByRole("dialog");
    fireEvent.change(within(edit).getByLabelText("Value"), { target: { value: second } });
    await act(async () => {
      fireEvent.click(within(edit).getByRole("button", { name: "Apply changes" }));
    });
    expect((router.state.location.search.filter ?? []).join(" ")).toBe(
      `${key}:${JSON.stringify(second)}`,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Disable filter ${key}` }));
    });
    expect((router.state.location.search.filter ?? []).join(" ")).toBe("");
    expect(readFilterQuery(router.state.location.search).filters).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Enable filter ${key}` }));
    });
    expect((router.state.location.search.filter ?? []).join(" ")).toBe(
      `${key}:${JSON.stringify(second)}`,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Remove filter ${key}` }));
    });
    expect(readFilterQuery(router.state.location.search).filters).toEqual([]);
  });
  it("does not add an invalid key", async () => {
    const store = createStore();
    const { router, wrapper } = await createTestRouter("/logs", store);
    render(<LogFilterBar />, { wrapper });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add filter" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("attributes.key");
    expect(readFilterQuery(router.state.location.search).filters).toEqual([]);
  });
});

it("replaces a standard field with an attribute without retaining its old field mapping", async () => {
  const store = createStore();
  const { router, wrapper } = await createTestRouter("/logs?filter=trace_id%3A%22abc%22", store);
  render(<LogFilterBar />, { wrapper });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit filter trace_id" }));
  });
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Key"), {
    target: { value: "attributes.http.method" },
  });
  fireEvent.change(within(dialog).getByLabelText("Value"), { target: { value: "GET" } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
  });
  expect((router.state.location.search.filter ?? []).join(" ")).toBe(
    'attributes.http.method:"GET"',
  );
  expect(readFilterQuery(router.state.location.search).filters[0].field).toBeUndefined();
});
