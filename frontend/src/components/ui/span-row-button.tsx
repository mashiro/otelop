import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const spanRowButtonVariants = cva("flex w-full items-center text-left transition-colors", {
  variants: {
    variant: {
      tree: "h-full cursor-pointer gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      service: "h-8 gap-2 px-3 text-xs",
    },
    hovered: { true: "bg-trace/5" },
    selected: { true: "bg-trace/10" },
    reserveLinks: { true: "", false: "" },
  },
  compoundVariants: [
    { variant: "tree", reserveLinks: true, className: "pr-14" },
    { variant: "tree", reserveLinks: false, className: "pr-2" },
  ],
  defaultVariants: { variant: "tree", reserveLinks: false },
});

// The tree and service cells share row state while owning their own button
// appearance; TooltipTrigger only supplies tooltip behavior through render.
function SpanRowButton({
  className,
  variant,
  hovered,
  selected,
  reserveLinks,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof spanRowButtonVariants>) {
  return (
    <button
      type="button"
      className={cn(spanRowButtonVariants({ variant, hovered, selected, reserveLinks }), className)}
      {...props}
    />
  );
}

export { SpanRowButton };
