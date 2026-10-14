import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createTestRouter } from "@/test/router";
import { makeLog } from "@/test/factories";
import { LogDetail } from "./log-detail";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

async function renderLog(body: string) {
  const { wrapper } = await createTestRouter("/logs");
  return render(
    <LogDetail
      log={makeLog({ body })}
      onClose={vi.fn()}
      onNavigateToTrace={vi.fn()}
      onShowContext={vi.fn()}
    />,
    { wrapper },
  );
}

describe("LogDetail body", () => {
  it.each(["", " \n\t "])(
    "omits the body section and its filter when visually empty: %j",
    async (body) => {
      await renderLog(body);
      expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Body" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Filter by body" })).toBeNull();
    },
  );

  it("preserves nonempty body text and its filter", async () => {
    const body = "  first line\nsecond line  ";
    await renderLog(body);
    expect(screen.getByRole("region", { name: "Body" }).textContent).toBe(body);
    expect(screen.getByRole("button", { name: "Filter by body" })).toBeTruthy();
  });
});
