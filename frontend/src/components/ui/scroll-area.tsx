import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function ScrollArea({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="scroll-area" className={cn("relative", className)} {...props}>
      <div
        data-slot="scroll-area-viewport"
        tabIndex={0}
        className="size-full overflow-auto rounded-[inherit] scheme-light dark:scheme-dark transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
      >
        {children}
      </div>
    </div>
  );
}

export { ScrollArea };
