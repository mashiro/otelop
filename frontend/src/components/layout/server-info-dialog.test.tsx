import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { act, render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ServerInfoDialog } from "./server-info-dialog";
import { makeServerInfoResponse, makeLargeServerInfoResponse } from "@/test/factories";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

afterEach(cleanup);
beforeEach(() => {
  requestMock.mockReset();
});

async function openDialog() {
  render(<ServerInfoDialog />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Server info" }));
  });
  return screen.findByRole("dialog");
}

describe("ServerInfoDialog", () => {
  it("does not fetch server info until the dialog is opened", () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    render(<ServerInfoDialog />);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("shows the version as a badge in the title and uptime/started in the description", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({
        status: {
          uptimeMs: 123_000,
          startedAt: new Date(2026, 8, 23, 6, 0, 47).toISOString(),
        },
      }),
    );
    const dialog = await openDialog();

    await within(dialog).findByText("v1.2.3");
    expect(within(dialog).getByText(/Up 2m 3s/)).toBeTruthy();
    expect(within(dialog).getByText(/started 2026-09-23/)).toBeTruthy();
  });

  it("renders the Storage, Signals, Retention, Tables, and Endpoints cards", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    await within(dialog).findByText("Storage");
    expect(within(dialog).getByText("Signals")).toBeTruthy();
    expect(within(dialog).getAllByText("Retention").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByText("Tables")).toBeTruthy();
    expect(within(dialog).getByText("Endpoints")).toBeTruthy();
    expect(within(dialog).getByText("Traces")).toBeTruthy();
    expect(within(dialog).getByText("Metrics")).toBeTruthy();
    expect(within(dialog).getByText("Logs")).toBeTruthy();
    expect(within(dialog).getByText(":4319")).toBeTruthy();
  });

  it("shows DuckDB memory usage against its limit", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    const memory = await within(dialog).findByText("Memory");
    expect(memory.parentElement?.textContent).toBe("Memory8.39 MB / 537 MB");
  });

  it("formats large row counts with thousands separators", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({ storage: { tables: [{ name: "spans", rows: 1_234_567 }] } }),
    );
    const dialog = await openDialog();

    await within(dialog).findByText("1,234,567");
  });

  it('shows "Not run yet" and hides Max-size iterations when lastSweep is null', async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse({ lastSweep: null }));
    const dialog = await openDialog();

    await within(dialog).findByText("Not run yet");
    expect(within(dialog).queryByText("Max-size iterations")).toBeNull();
  });

  it("renders the last sweep summary and a destructive, wrapping error alert when present", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({
        lastSweep: {
          startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
          durationMs: 850,
          deletedRows: 1234,
          maxSizeIterations: 2,
          error: "storage: checkpoint: disk full",
        },
      }),
    );
    const dialog = await openDialog();

    await within(dialog).findByText(/12m ago/);
    expect(within(dialog).getByText(/deleted 1,234 rows in 850ms/)).toBeTruthy();
    expect(within(dialog).getByText("Max-size iterations")).toBeTruthy();

    const error = within(dialog).getByText("storage: checkpoint: disk full");
    expect(error.getAttribute("data-slot")).toBe("alert-description");
    const alert = error.closest('[data-slot="alert"]');
    expect(alert?.className).toContain("text-destructive");
  });

  it("shows an error message when the fetch fails", async () => {
    requestMock.mockRejectedValue(new Error("network error"));
    const dialog = await openDialog();

    await within(dialog).findByText("Failed to load server info.");
  });

  it("wraps the storage path with a <wbr> after every slash, never mid-segment", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({
        status: {
          config: {
            storagePath: "/var/folders/otelop.duckdb",
            retention: "7d",
            maxSize: "4GB",
            traceCount: 10,
            metricCount: 2,
            logCount: 40,
          },
        },
      }),
    );
    const dialog = await openDialog();

    const pathEl = await within(dialog).findByTitle("/var/folders/otelop.duckdb");
    expect(pathEl.textContent).toBe("/var/folders/otelop.duckdb");
    expect(pathEl.querySelectorAll("wbr").length).toBe(3);
  });

  it("truncates other values (e.g. addresses) instead of wrapping", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    const httpAddr = within(dialog).getByText(":4319");
    expect(httpAddr.className).toContain("truncate");
  });

  it("formats production-scale values and keeps the full error message available", async () => {
    requestMock.mockResolvedValue(makeLargeServerInfoResponse());
    const dialog = await openDialog();

    await within(dialog).findByText("168,248");
    expect(within(dialog).getByText("178")).toBeTruthy();
    expect(within(dialog).getAllByText("3,028,393").length).toBe(3);
    expect(within(dialog).getByText("1.32 GB")).toBeTruthy();
    expect(within(dialog).getByText("33%")).toBeTruthy();

    const errorText =
      "storage: checkpoint: disk full: no space left on device while writing write-ahead log segment 00000482";
    const errorValue = within(dialog).getByText(errorText);
    expect(errorValue.className).not.toContain("truncate");

    const longPath =
      "/var/folders/dx/nrqfyl811vv5504krhcv4r_r0000gn/T/some-really-long-directory-name-that-keeps-going/otelop-production-instance/otelop.duckdb";
    const pathEl = within(dialog).getByTitle(longPath);
    expect(pathEl.querySelectorAll("wbr").length).toBeGreaterThan(0);
  });
});
