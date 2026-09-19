import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function HelpTooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent wrap>{content}</TooltipContent>
    </Tooltip>
  );
}
