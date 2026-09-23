import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ScrollableTable } from "./scrollable-table";
import { TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("ScrollableTable accessibility", () => {
  it("exposes one table with column headers and their data cells together", () => {
    render(
      <ScrollableTable
        header={
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
        }
      >
        <TableBody>
          <TableRow>
            <TableCell>checkout</TableCell>
            <TableCell>12 ms</TableCell>
          </TableRow>
        </TableBody>
      </ScrollableTable>,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Service" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "Duration" })).toBeTruthy();
    expect(within(table).getByRole("cell", { name: "checkout" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });
});
