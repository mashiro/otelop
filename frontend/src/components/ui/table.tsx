"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import type { SignalTone } from "@/lib/signals";

// Shared signal tone for table rows and cells.
export type { SignalTone };

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-xs", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky top-0 z-10 [&_tr]:border-b [&_tr]:border-border/50 bg-card", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-border/50 bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

const tableRowVariants = cva("border-b border-border/40 transition-colors", {
  variants: {
    tone: {
      none: "hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
      trace: "hover:bg-trace/5",
      metric: "hover:bg-metric/5",
      log: "hover:bg-log/5",
    },
    interactive: {
      true: "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
      false: "",
    },
    stagger: {
      true: "stagger-row",
      false: "",
    },
    selected: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    { tone: "trace", selected: true, class: "bg-trace/10" },
    { tone: "metric", selected: true, class: "bg-metric/10" },
    { tone: "log", selected: true, class: "bg-log/10" },
  ],
  defaultVariants: {
    tone: "none",
    interactive: false,
    stagger: false,
    selected: false,
  },
});

function TableRow({
  className,
  tone = "none",
  interactive = false,
  stagger = false,
  selected = false,
  ...props
}: React.ComponentProps<"tr"> & VariantProps<typeof tableRowVariants>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(tableRowVariants({ tone, interactive, stagger, selected }), className)}
      {...props}
    />
  );
}

const tableHeadVariants = cva(
  "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
  {
    variants: {
      align: { left: "", right: "text-right" },
    },
  },
);

function TableHead({
  className,
  align = "left",
  ...props
}: React.ComponentProps<"th"> & VariantProps<typeof tableHeadVariants>) {
  return (
    <th data-slot="table-head" className={cn(tableHeadVariants({ align }), className)} {...props} />
  );
}

const tableCellVariants = cva("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", {
  variants: {
    // Font family/scale axis, orthogonal to `emphasis`'s color/weight axis
    // (e.g. `mono` + `emphasis="muted"` reproduces the old "mono-muted").
    variant: {
      default: "",
      mono: "font-mono text-xs",
    },
    emphasis: {
      default: "",
      strong: "font-medium",
      secondary: "text-foreground/80",
      muted: "text-muted-foreground",
    },
    // Only needed to reproduce the old "muted-xs" (`emphasis="muted"
    // size="xs"`); `mono` already implies `text-xs` on its own.
    size: {
      default: "",
      xs: "text-xs",
    },
    tone: {
      none: "",
      trace: "text-trace",
      metric: "text-metric",
      log: "text-log",
    },
    align: {
      left: "",
      right: "text-right",
    },
    truncate: {
      true: "truncate",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    emphasis: "default",
    size: "default",
    tone: "none",
    align: "left",
    truncate: false,
  },
});

function TableCell({
  className,
  variant = "default",
  emphasis = "default",
  size = "default",
  tone = "none",
  align = "left",
  truncate = false,
  ...props
}: React.ComponentProps<"td"> & VariantProps<typeof tableCellVariants>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        tableCellVariants({ variant, emphasis, size, tone, align, truncate }),
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  tableRowVariants,
  tableHeadVariants,
  tableCellVariants,
};
