import { useMediaQuery } from "./use-media-query";

// Reads the breakpoint from the theme (index.css emits it via @theme static)
// so JS layout switches stay in step with the matching sm: utilities.
export function useBreakpoint(name: "sm"): boolean {
  const width = getComputedStyle(document.documentElement)
    .getPropertyValue(`--breakpoint-${name}`)
    .trim();
  return useMediaQuery(`(min-width: ${width})`);
}
