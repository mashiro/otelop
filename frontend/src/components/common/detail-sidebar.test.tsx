import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DetailSidebar } from "./detail-sidebar";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";

// Base UI's ScrollArea calls Element.getAnimations(), which happy-dom (this
// project's test environment) doesn't implement — see the identical mock in
// metric-detail.test.tsx.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

afterEach(cleanup);

describe("DetailSidebar", () => {
  it("renders the title, tone color, and children", () => {
    render(
      <DetailSidebar title="Span Details" tone="trace" onClose={() => {}}>
        <p>body content</p>
      </DetailSidebar>,
    );

    const title = screen.getByText("Span Details");
    expect(title.className).toContain("text-trace");
    expect(screen.getByText("body content")).toBeTruthy();
  });

  it("renders actions before the close button", () => {
    render(
      <DetailSidebar
        title="Log Details"
        tone="log"
        onClose={() => {}}
        actions={<button>Copy JSON</button>}
      >
        <p>body</p>
      </DetailSidebar>,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Copy JSON", ""]);
  });

  it("gives the close button an accessible name, Escape hint, and calls onClose when clicked", () => {
    const onClose = vi.fn();
    render(
      <DetailSidebar title="Data Point Details" tone="metric" onClose={onClose}>
        <p>body</p>
      </DetailSidebar>,
    );

    const closeButton = screen.getByRole("button", { name: "Close details" });
    expect(closeButton.getAttribute("aria-keyshortcuts")).toBe("Escape");
    expect(closeButton.getAttribute("title")).toBe("Close details (Esc)");

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses closeLabel for the close button's accessible name and title when given", () => {
    render(
      <DetailSidebar
        title="Data Point Details"
        tone="metric"
        onClose={() => {}}
        closeLabel="Close data point details"
      >
        <p>body</p>
      </DetailSidebar>,
    );

    const closeButton = screen.getByRole("button", { name: "Close data point details" });
    expect(closeButton.getAttribute("title")).toBe("Close data point details (Esc)");
  });

  it("closes on Escape, taking priority over an enclosing panel's own Escape listener", () => {
    const onClose = vi.fn();
    const onPanelEscape = vi.fn();
    function EnclosingPanel() {
      useKeyboardShortcut("Escape", onPanelEscape);
      return (
        <DetailSidebar title="Span Details" tone="trace" onClose={onClose}>
          <p>body</p>
        </DetailSidebar>
      );
    }
    render(<EnclosingPanel />);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPanelEscape).not.toHaveBeenCalled();
  });
});
