import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none data-[variant=pill]:rounded-none data-[variant=pill]:p-0",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        // The primary nav bar: a fully transparent, ungapped-from-default list
        // whose triggers carry their own pill chrome (see TabsTrigger size="lg").
        pill: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

const tabsTriggerVariants = cva(
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 border border-transparent whitespace-nowrap transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-[calc(--spacing(1.25))] hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
  {
    variants: {
      size: {
        default:
          "rounded-md px-1.5 py-0.5 text-xs font-medium text-foreground/60 dark:text-muted-foreground data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        lg: "rounded-md px-3 py-1 text-xs font-medium text-muted-foreground",
      },
      // Declared after `size` so its data-active:bg/text classes win the
      // tailwind-merge conflict against size's own data-active chrome.
      tone: {
        trace:
          "data-active:bg-trace/15 data-active:text-trace dark:data-active:bg-trace/15 dark:data-active:text-trace",
        metric:
          "data-active:bg-metric/15 data-active:text-metric dark:data-active:bg-metric/15 dark:data-active:text-metric",
        log: "data-active:bg-log/15 data-active:text-log dark:data-active:bg-log/15 dark:data-active:text-log",
      },
    },
    compoundVariants: [
      { size: "lg", tone: "trace", class: "data-active:shadow-glow data-active:shadow-trace/20" },
      { size: "lg", tone: "metric", class: "data-active:shadow-glow data-active:shadow-metric/20" },
      { size: "lg", tone: "log", class: "data-active:shadow-glow data-active:shadow-log/20" },
    ],
    defaultVariants: {
      size: "default",
    },
  },
);

function TabsTrigger({
  className,
  size,
  tone,
  ...props
}: TabsPrimitive.Tab.Props & VariantProps<typeof tabsTriggerVariants>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ size, tone }), className)}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-xs/relaxed outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
