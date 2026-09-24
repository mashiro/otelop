import { useMediaQuery } from "./use-media-query";

// Theme values never change at runtime, so each is read once; an empty read
// (CSS not applied yet) is not cached, so a later render can pick it up.
const widths = new Map<string, string>();

function breakpointWidth(name: string): string {
  let width = widths.get(name);
  if (!width) {
    width = getComputedStyle(document.documentElement)
      .getPropertyValue(`--breakpoint-${name}`)
      .trim();
    if (width) widths.set(name, width);
  }
  return width;
}

// Reads the breakpoint from the theme (index.css emits it via @theme static)
// so JS layout switches stay in step with the matching sm: utilities.
export function useBreakpoint(name: "sm"): boolean {
  const width = breakpointWidth(name);
  return useMediaQuery(width ? `(min-width: ${width})` : "not all");
}
