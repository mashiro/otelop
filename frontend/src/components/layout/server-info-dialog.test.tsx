import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { act, render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ServerInfoDialog } from "./server-info-dialog";
import { makeServerInfoResponse, makeLargeServerInfoResponse } from "@/test/factories";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

const writeText = vi.fn();

afterEach(cleanup);
beforeEach(() => {
  requestMock.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

async function openDialog() {
  render(<ServerInfoDialog />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Server info" }));
  });
  return screen.findByRole("dialog");
}

async function selectTab(dialog: HTMLElement, name: string) {
  const tab = await within(dialog).findByRole("tab", { name });
  await act(async () => {
    fireEvent.click(tab);
  });
}

// The value side (ItemActions) of the row a label sits in.
function rowValue(dialog: HTMLElement, label: string) {
  const row = within(dialog).getByText(label).closest('[data-slot="item"]');
  return row?.querySelector('[data-slot="item-actions"]')?.textContent;
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

  it("opens on Overview with endpoints, resource usage, and a retention summary only", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    const tabs = await within(dialog).findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Storage", "Runtime"]);
    expect(rowValue(dialog, "OTLP gRPC")).toBe("0.0.0.0:4317");
    expect(rowValue(dialog, "OTLP HTTP")).toBe("0.0.0.0:4318");
    expect(rowValue(dialog, "Web UI")).toBe(":4319");
    expect(within(dialog).getByRole("progressbar", { name: "Disk usage" })).toBeTruthy();
    expect(within(dialog).getByRole("progressbar", { name: "Memory usage" })).toBeTruthy();
    expect(rowValue(dialog, "Disk")).toBe("1.05 MB of 4.29 GB");
    expect(rowValue(dialog, "Memory")).toBe("8.39 MB of 537 MB");
    expect(within(dialog).getByText(/Keeps 7d of data/)).toBeTruthy();
    expect(within(dialog).queryByText("Tables")).toBeNull();
    expect(within(dialog).queryByText("Traces")).toBeNull();
  });

  it("copies an endpoint address", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    await act(async () => {
      fireEvent.click(await within(dialog).findByRole("button", { name: "Copy OTLP gRPC" }));
    });
    expect(writeText).toHaveBeenCalledWith("0.0.0.0:4317");
  });

  it("surfaces a failed sweep on Overview", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({
        lastSweep: {
          startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
          durationMs: 850,
          deletedRows: 0,
          maxSizeIterations: 0,
          error: "storage: checkpoint: disk full",
        },
      }),
    );
    const dialog = await openDialog();

    const error = await within(dialog).findByText("storage: checkpoint: disk full");
    expect(error.closest('[data-slot="alert"]')?.className).toContain("text-destructive");
    expect(within(dialog).getByText("Last sweep failed")).toBeTruthy();
  });

  it("shows file details, retained data, sweep, and tables on the Storage tab", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();
    await selectTab(dialog, "Storage");

    expect(rowValue(dialog, "WAL")).toBe("4.10 KB");
    expect(rowValue(dialog, "Blocks")).toBe("64 used, 64 free");
    expect(rowValue(dialog, "Traces")).toBe("10");
    expect(rowValue(dialog, "Logs")).toBe("40");
    expect(rowValue(dialog, "Retention")).toBe("7d");
    expect(rowValue(dialog, "Last sweep")).toBe("Not run yet");
    expect(within(dialog).queryByText("Max-size iterations")).toBeNull();
    expect(rowValue(dialog, "spans")).toBe("120 rows");
  });

  it("copies the database path and wraps it only at slashes", async () => {
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
    await selectTab(dialog, "Storage");

    const pathEl = within(dialog).getByTitle("/var/folders/otelop.duckdb");
    expect(pathEl.textContent).toBe("/var/folders/otelop.duckdb");
    expect(pathEl.querySelectorAll("wbr").length).toBe(3);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Copy database path" }));
    });
    expect(writeText).toHaveBeenCalledWith("/var/folders/otelop.duckdb");
  });

  it("renders the last sweep summary and max-size iterations when present", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({
        lastSweep: {
          startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
          durationMs: 850,
          deletedRows: 1234,
          maxSizeIterations: 2,
          error: "",
        },
      }),
    );
    const dialog = await openDialog();
    await selectTab(dialog, "Storage");

    expect(rowValue(dialog, "Last sweep")).toBe("12m ago, deleted 1,234 rows in 850ms");
    expect(rowValue(dialog, "Max-size iterations")).toBe("2");
  });

  it("shows proxy, debug, and log level on the Runtime tab", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({
        status: { proxyUrl: "https://collector.example.com:4318", proxyProtocol: "http" },
      }),
    );
    const dialog = await openDialog();
    await selectTab(dialog, "Runtime");

    expect(rowValue(dialog, "Proxy")).toBe("https://collector.example.com:4318 (http)");
    expect(rowValue(dialog, "Debug")).toBe("off");
    expect(rowValue(dialog, "Log level")).toBe("warn");
  });

  it("shows an error message when the fetch fails", async () => {
    requestMock.mockRejectedValue(new Error("network error"));
    const dialog = await openDialog();

    await within(dialog).findByText("Failed to load server info.");
  });

  it("truncates addresses instead of wrapping", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    const httpAddr = await within(dialog).findByText(":4319");
    expect(httpAddr.className).toContain("truncate");
  });

  it("formats production-scale values and keeps the full error message available", async () => {
    requestMock.mockResolvedValue(makeLargeServerInfoResponse());
    const dialog = await openDialog();

    const errorText =
      "storage: checkpoint: disk full: no space left on device while writing write-ahead log segment 00000482";
    const errorValue = await within(dialog).findByText(errorText);
    expect(errorValue.className).not.toContain("truncate");
    expect(rowValue(dialog, "Disk")).toBe("1.32 GB of 4.00 GB");

    await selectTab(dialog, "Storage");
    expect(rowValue(dialog, "Traces")).toBe("168,248");
    expect(rowValue(dialog, "Logs")).toBe("3,028,393");
    expect(rowValue(dialog, "metric_points")).toBe("12,884,901 rows");
    const longPath =
      "/var/folders/dx/nrqfyl811vv5504krhcv4r_r0000gn/T/some-really-long-directory-name-that-keeps-going/otelop-production-instance/otelop.duckdb";
    expect(within(dialog).getByTitle(longPath).querySelectorAll("wbr").length).toBeGreaterThan(0);
  });

  it("stacks the tab list above the content on narrow screens", async () => {
    const matchMedia = vi.spyOn(window, "matchMedia");
    matchMedia.mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    await within(dialog).findByRole("tablist");
    const tabs = dialog.querySelector('[data-slot="tabs"]');
    expect(tabs?.getAttribute("data-orientation")).toBe("horizontal");
    matchMedia.mockRestore();
  });
});
