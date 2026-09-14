import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function HelpTooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="max-w-[min(20rem,calc(100vw-2rem))] break-words">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
