import { describe, it, expect } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

describe("TooltipContent wrap", () => {
  it("wrap=false (default) keeps the fixed max-w-xs and does not break words", async () => {
    render(
      <Tooltip defaultOpen>
        <TooltipTrigger render={<button type="button">Trigger</button>} />
        <TooltipContent>Hint</TooltipContent>
      </Tooltip>,
    );
    const content = await screen.findByText("Hint");
    expect(content.className).toContain("max-w-xs");
    expect(content.className).not.toContain("break-words");
  });

  it("wrap=true widens to a viewport-relative max-width and breaks long words", async () => {
    render(
      <Tooltip defaultOpen>
        <TooltipTrigger render={<button type="button">Trigger</button>} />
        <TooltipContent wrap>Long content</TooltipContent>
      </Tooltip>,
    );
    const content = await screen.findByText("Long content");
    expect(content.className).toContain("max-w-[min(20rem,calc(100vw-2rem))]");
    expect(content.className).toContain("break-words");
    expect(content.className).not.toContain("max-w-xs");
  });
});
