import { describe, it, expect, vi } from "vite-plus/test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CopyButton } from "./copy-button";

describe("CopyButton", () => {
  it("writes the value and confirms the copy", async () => {
    const write = vi.fn().mockResolvedValue(true);
    render(<CopyButton value="localhost:4317" write={write} tooltip="Copy" label="Copy OTLP" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy OTLP" }));
    });
    expect(write).toHaveBeenCalledWith("localhost:4317");
    expect(screen.getByRole("button", { name: "Copy OTLP" }).innerHTML).toContain("lucide-check");
    expect(screen.getByRole("status").textContent).toBe("Copied");
  });

  it("shows a failed copy instead of doing nothing", async () => {
    render(
      <CopyButton value={{ a: 1 }} write={vi.fn().mockResolvedValue(false)} tooltip="Copy as JSON">
        JSON
      </CopyButton>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    });
    expect(screen.getByRole("button", { name: "Copy failed" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Copy failed");
  });

  it("does not update after unmounting while the write is pending", async () => {
    let resolve: (ok: boolean) => void = () => {};
    const write = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { unmount } = render(<CopyButton value="x" write={write} tooltip="Copy" label="Copy" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    unmount();
    const before = setTimeoutSpy.mock.calls.length;
    await act(async () => resolve(true));
    expect(setTimeoutSpy.mock.calls.length).toBe(before);
    setTimeoutSpy.mockRestore();
  });
});
