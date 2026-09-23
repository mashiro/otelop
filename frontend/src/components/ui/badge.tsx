import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        soft: "",
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      tone: {
        success: "bg-success/15 text-success",
        destructive: "bg-destructive/15 text-destructive",
        warning: "bg-warning/15 text-warning",
        primary: "bg-primary/15 text-primary",
        muted: "bg-muted text-muted-foreground",
        trace: "bg-trace/15 text-trace",
        metric: "bg-metric/15 text-metric",
        log: "bg-log/15 text-log",
      },
      size: {
        default: "",
        sm: "h-auto border-0 text-2xs",
        counter: "h-auto gap-1.5 rounded-md border-0",
      },
    },
    compoundVariants: [
      { tone: "trace", size: "counter", className: "bg-trace/10" },
      { tone: "metric", size: "counter", className: "bg-metric/10" },
      { tone: "log", size: "counter", className: "bg-log/10" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  tone,
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, tone, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
      tone,
      size,
    },
  });
}

function BadgeDot() {
  return (
    <span
      aria-hidden="true"
      className="size-1.5 shrink-0 rounded-full bg-current group-data-[tone=muted]/badge:opacity-40"
    />
  );
}

export { Badge, BadgeDot, badgeVariants };
