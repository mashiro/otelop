import { useRef, type PointerEvent } from "react";
import type { TimelineRange } from "./trace-timeline";

interface SelectionDrag {
  pointerId: number;
  startX: number;
  left: number;
  width: number;
  started: boolean;
}

export function useTraceRangeSelection(onChange: (range: TimelineRange) => void) {
  const selection = useRef<SelectionDrag | null>(null);

  function updateSelection(event: PointerEvent<HTMLDivElement>) {
    const drag = selection.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.started && Math.abs(event.clientX - drag.startX) < 3) return;
    drag.started = true;
    const toStep = (x: number) =>
      Math.max(0, Math.min(1000, Math.round(((x - drag.left) / drag.width) * 1000)));
    const anchor = toStep(drag.startX);
    const current = toStep(event.clientX);
    const lower = Math.min(999, anchor, current);
    onChange([lower / 10, Math.max(lower + 1, anchor, current) / 10]);
  }

  function clearSelection(event: PointerEvent<HTMLDivElement>) {
    if (selection.current?.pointerId === event.pointerId) selection.current = null;
  }

  return {
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      if (
        selection.current ||
        event.button !== 0 ||
        (event.target as Element).closest("[data-overview-thumb]")
      )
        return;
      const { left, width } = event.currentTarget.getBoundingClientRect();
      if (width <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      selection.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        left,
        width,
        started: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: updateSelection,
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      updateSelection(event);
      clearSelection(event);
    },
    onPointerCancel: clearSelection,
    onLostPointerCapture: clearSelection,
  };
}
