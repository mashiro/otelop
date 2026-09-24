import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { act, render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ServerInfoDialog } from "./server-info-dialog";
import { queryClient } from "@/lib/query-client";
import {
  makeServerInfoResponse,
  makeLargeServerInfoResponse,
  rowValue,
  selectTab,
  setViewport,
} from "@/test/factories";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

const writeText = vi.fn();

afterEach(cleanup);
beforeEach(() => {
  // index.css (which emits this via @theme static) isn't loaded in tests.
  document.documentElement.style.setProperty("--breakpoint-sm", "40rem");
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
    const { hostname, host } = window.location;
    expect(rowValue(dialog, "OTLP gRPC")).toBe(`${hostname}:4317`);
    expect(rowValue(dialog, "OTLP HTTP")).toBe(`${hostname}:4318`);
    expect(rowValue(dialog, "Web UI")).toBe(host);
    const disk = within(dialog).getByRole("progressbar", { name: "Disk" });
    const memory = within(dialog).getByRole("progressbar", { name: "Memory" });
    expect(disk.getAttribute("aria-valuetext")).toBe("1.05 MB of 4.29 GB, 0%");
    expect(memory.getAttribute("aria-valuetext")).toBe("8.39 MB of 537 MB, 2%");
    expect(disk.textContent).toContain("1.05 MB of 4.29 GB0%");
    expect(within(dialog).getByText(/Keeps 7d of data, next sweep at \d{4}-/)).toBeTruthy();
    expect(within(dialog).queryByText("Tables")).toBeNull();
    expect(within(dialog).queryByText("Traces")).toBeNull();
  });

  it("copies the endpoint as the browser host plus the bind port", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    await act(async () => {
      fireEvent.click(await within(dialog).findByRole("button", { name: "Copy OTLP gRPC" }));
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.hostname}:4317`);
  });

  it("shows usage past its limit instead of capping it at 100%", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({
        storage: { fileSizeBytes: 6_000_000_000, maxSizeBytes: 4_000_000_000 },
      }),
    );
    const dialog = await openDialog();

    const disk = await within(dialog).findByRole("progressbar", { name: "Disk" });
    expect(disk.getAttribute("aria-valuetext")).toBe("6.00 GB of 4.00 GB, 150%");
    expect(disk.textContent).toContain("150%");
  });

  it("shows a dash without a copy button when a bind address has no port", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse({ status: { otlpGrpcAddr: "" } }));
    const dialog = await openDialog();

    await within(dialog).findByText("OTLP gRPC");
    expect(rowValue(dialog, "OTLP gRPC")).toBe("—");
    expect(within(dialog).queryByRole("button", { name: "Copy OTLP gRPC" })).toBeNull();
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

    await selectTab(dialog, "Storage");
    expect(within(dialog).getByText("Last sweep failed")).toBeTruthy();
    expect(within(dialog).getByText("storage: checkpoint: disk full")).toBeTruthy();
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
    const summary = within(dialog).getByText("12m ago, deleted 1,234 rows in 850ms");
    expect(summary.className).toContain("break-words");
    expect(summary.className).not.toContain("truncate");
    expect(summary.getAttribute("title")).toBeNull();
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

  it("keeps showing the last data without an error when a background refetch fails", async () => {
    requestMock.mockResolvedValueOnce(makeServerInfoResponse());
    const dialog = await openDialog();
    await within(dialog).findByText("OTLP gRPC");

    requestMock.mockRejectedValue(new Error("network error"));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["server-info"] });
    });

    expect(queryClient.getQueryState(["server-info"])?.status).toBe("error");
    // react-query batches observer notifications onto a timer.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(within(dialog).getByText("OTLP gRPC")).toBeTruthy();
    expect(within(dialog).queryByText("Failed to load server info.")).toBeNull();
  });

  it("reports the retention storage applies, not the raw configured string", async () => {
    requestMock.mockResolvedValue(
      makeServerInfoResponse({ storage: { retentionMs: 259_200_000 } }),
    );
    const dialog = await openDialog();

    expect(await within(dialog).findByText(/Keeps 3d of data/)).toBeTruthy();
    await selectTab(dialog, "Storage");
    expect(rowValue(dialog, "Retention")).toBe("3d");
  });

  it("shows an error message when the fetch fails, without the tabbed layout's fixed height", async () => {
    requestMock.mockRejectedValue(new Error("network error"));
    const dialog = await openDialog();

    await within(dialog).findByText("Failed to load server info.");
    expect(dialog.className).not.toContain("h-128");
  });

  it("truncates addresses instead of wrapping", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    const webUi = await within(dialog).findByText(window.location.host);
    expect(webUi.className).toContain("truncate");
  });

  it("formats production-scale values and keeps the full error message available", async () => {
    requestMock.mockResolvedValue(makeLargeServerInfoResponse());
    const dialog = await openDialog();

    const errorText =
      "storage: checkpoint: disk full: no space left on device while writing write-ahead log segment 00000482";
    const errorValue = await within(dialog).findByText(errorText);
    expect(errorValue.className).not.toContain("truncate");
    const disk = within(dialog).getByRole("progressbar", { name: "Disk" });
    expect(disk.getAttribute("aria-valuetext")).toBe("1.32 GB of 4.00 GB, 33%");

    await selectTab(dialog, "Storage");
    expect(rowValue(dialog, "Traces")).toBe("168,248");
    expect(rowValue(dialog, "Logs")).toBe("3,028,393");
    expect(rowValue(dialog, "metric_points")).toBe("12,884,901 rows");
    const longPath =
      "/var/folders/dx/nrqfyl811vv5504krhcv4r_r0000gn/T/some-really-long-directory-name-that-keeps-going/otelop-production-instance/otelop.duckdb";
    expect(within(dialog).getByTitle(longPath).querySelectorAll("wbr").length).toBeGreaterThan(0);
  });

  it("stacks the tab list above the content on narrow screens", async () => {
    const { innerWidth, innerHeight } = window;
    setViewport(400, 800);
    try {
      requestMock.mockResolvedValue(makeServerInfoResponse());
      const dialog = await openDialog();

      const tablist = await within(dialog).findByRole("tablist");
      // Horizontal is ARIA's default, so Base UI leaves the attribute off.
      expect(tablist.getAttribute("aria-orientation")).not.toBe("vertical");
    } finally {
      setViewport(innerWidth, innerHeight);
    }
  });

  it("puts the tab list beside the content on wider screens", async () => {
    requestMock.mockResolvedValue(makeServerInfoResponse());
    const dialog = await openDialog();

    const tablist = await within(dialog).findByRole("tablist");
    expect(tablist.getAttribute("aria-orientation")).toBe("vertical");
  });
});
