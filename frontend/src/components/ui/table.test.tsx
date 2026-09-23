import { describe, it, expect } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { TableHeader, TableRow, TableHead, TableCell } from "./table";

// Every case wraps rows in <table><tbody> to avoid React's DOM-nesting
// warnings for bare <tr>/<td>/<th> — see AGENTS.md's TableRow/TableHead/
// TableCell cva variants (tone/interactive/stagger/selected/variant/align).
// TableCell's variant (font family/scale: default|mono), emphasis
// (color/weight: default|strong|secondary|muted), and size (default|xs) are
// orthogonal axes — see the combined case below reproducing "mono-muted".

describe("TableHeader", () => {
  it("bakes the shared header-row border/background directly into TableHeader, needing no className on TableRow", () => {
    render(
      <table>
        <TableHeader>
          <TableRow>
            <TableHead>Col</TableHead>
          </TableRow>
        </TableHeader>
      </table>,
    );
    const thead = screen.getByRole("rowgroup");
    expect(thead.className).toContain("[&_tr]:border-b");
    expect(thead.className).toContain("[&_tr]:border-border/50");
    expect(thead.className).toContain("bg-card");
  });
});

describe("TableRow tone/interactive/stagger/selected", () => {
  it.each(["trace", "metric", "log"] as const)(
    "tone=%s applies the hover-faint treatment and drops the generic hover/selected classes",
    (tone) => {
      render(
        <table>
          <tbody>
            <TableRow tone={tone} data-testid="row">
              <TableCell>Cell</TableCell>
            </TableRow>
          </tbody>
        </table>,
      );
      const row = screen.getByTestId("row");
      expect(row.className).toContain(`hover:bg-${tone}/5`);
      expect(row.className).not.toContain("hover:bg-muted/50");
      expect(row.className).not.toContain("data-[state=selected]:bg-muted");
    },
  );

  it("tone=none (default) keeps the generic hover/selected treatment", () => {
    render(
      <table>
        <tbody>
          <TableRow data-testid="row">
            <TableCell>Cell</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );
    const row = screen.getByTestId("row");
    expect(row.className).toContain("hover:bg-muted/50");
    expect(row.className).toContain("data-[state=selected]:bg-muted");
  });

  it("interactive=true adds cursor-pointer; interactive=false (default) omits it", () => {
    const { rerender } = render(
      <table>
        <tbody>
          <TableRow interactive data-testid="row">
            <TableCell>Cell</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("row").className).toContain("cursor-pointer");

    rerender(
      <table>
        <tbody>
          <TableRow data-testid="row">
            <TableCell>Cell</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("row").className).not.toContain("cursor-pointer");
  });

  it("stagger=true adds the stagger-row class; stagger=false (default) omits it", () => {
    const { rerender } = render(
      <table>
        <tbody>
          <TableRow stagger data-testid="row">
            <TableCell>Cell</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("row").className).toContain("stagger-row");

    rerender(
      <table>
        <tbody>
          <TableRow data-testid="row">
            <TableCell>Cell</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("row").className).not.toContain("stagger-row");
  });

  it.each(["trace", "metric", "log"] as const)(
    "selected=true with tone=%s adds the matching bg-{tone}/10 compound variant",
    (tone) => {
      render(
        <table>
          <tbody>
            <TableRow tone={tone} selected data-testid="row">
              <TableCell>Cell</TableCell>
            </TableRow>
          </tbody>
        </table>,
      );
      expect(screen.getByTestId("row").className).toContain(`bg-${tone}/10`);
    },
  );

  it("selected=false with a tone omits the bg-{tone}/10 compound variant", () => {
    render(
      <table>
        <tbody>
          <TableRow tone="log" data-testid="row">
            <TableCell>Cell</TableCell>
          </TableRow>
        </tbody>
      </table>,
    );
    expect(screen.getByTestId("row").className).not.toContain("bg-log/10");
  });
});

describe("TableCell variant/emphasis/size/tone/align/truncate", () => {
  it.each([
    ["default", ""],
    ["mono", "font-mono text-xs"],
  ] as const)("variant=%s applies %s", (variant, expected) => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCell variant={variant}>Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    const cell = screen.getByRole("cell");
    for (const token of expected.split(" ").filter(Boolean)) {
      expect(cell.className).toContain(token);
    }
  });

  it.each([
    ["default", ""],
    ["strong", "font-medium"],
    ["secondary", "text-foreground/80"],
    ["muted", "text-muted-foreground"],
  ] as const)("emphasis=%s applies %s", (emphasis, expected) => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCell emphasis={emphasis}>Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    const cell = screen.getByRole("cell");
    for (const token of expected.split(" ").filter(Boolean)) {
      expect(cell.className).toContain(token);
    }
  });

  it("size=xs adds text-xs; size=default (default) omits it", () => {
    const { rerender } = render(
      <table>
        <tbody>
          <tr>
            <TableCell size="xs">Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell").className).toContain("text-xs");

    rerender(
      <table>
        <tbody>
          <tr>
            <TableCell>Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell").className).not.toContain("text-xs");
  });

  it("variant=mono + emphasis=muted reproduces the old mono-muted class set", () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCell variant="mono" emphasis="muted">
              Cell
            </TableCell>
          </tr>
        </tbody>
      </table>,
    );
    const cell = screen.getByRole("cell");
    expect(cell.className).toContain("font-mono");
    expect(cell.className).toContain("text-xs");
    expect(cell.className).toContain("text-muted-foreground");
  });

  it.each(["trace", "metric", "log"] as const)("tone=%s applies text-%s", (tone) => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCell tone={tone}>Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell").className).toContain(`text-${tone}`);
  });

  it("tone=none (default) adds no signal-color class", () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCell>Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    const cell = screen.getByRole("cell");
    expect(cell.className).not.toContain("text-trace");
    expect(cell.className).not.toContain("text-metric");
    expect(cell.className).not.toContain("text-log");
  });

  it("align=right adds text-right; align=left (default) omits it", () => {
    const { rerender } = render(
      <table>
        <tbody>
          <tr>
            <TableCell align="right">Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell").className).toContain("text-right");

    rerender(
      <table>
        <tbody>
          <tr>
            <TableCell>Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell").className).not.toContain("text-right");
  });

  it("truncate=true adds truncate; truncate=false (default) omits it", () => {
    const { rerender } = render(
      <table>
        <tbody>
          <tr>
            <TableCell truncate>Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell").className).toContain("truncate");

    rerender(
      <table>
        <tbody>
          <tr>
            <TableCell>Cell</TableCell>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("cell").className).not.toContain("truncate");
  });

  it("an instance className is preserved alongside variant output (tailwind-merge overrides conflicting utilities)", () => {
    render(
      <table>
        <tbody>
          <tr>
            <TableCell emphasis="muted" className="max-w-xs">
              Cell
            </TableCell>
          </tr>
        </tbody>
      </table>,
    );
    const cell = screen.getByRole("cell");
    expect(cell.className).toContain("text-muted-foreground");
    expect(cell.className).toContain("max-w-xs");
  });
});
