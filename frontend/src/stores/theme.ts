import { atomWithStorage } from "jotai/utils";

export type Theme = "light" | "dark" | "system";

// getOnInit: without it the atom starts at "system" and only loads storage in
// onMount. Header mounts it before App subscribes, and jotai 3 does not
// re-render late subscribers, so App's useThemeSync stays on "system" and
// strips the class index.html applied.
export const themeAtom = atomWithStorage<Theme>("theme", "system", undefined, {
  getOnInit: true,
});
