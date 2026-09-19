import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teaches tailwind-merge about the custom tokens declared in index.css's
// `@theme` block. Without this, twMerge doesn't recognize `text-3xs`/
// `text-2xs` as font-size steps or `shadow-glow`/`drop-shadow-glow` as
// shadow shapes, so it misclassifies them into the color groups and drops
// one class when they're combined with a real color utility (e.g.
// `shadow-glow` + `shadow-trace/20`). Keep this list in sync with the
// custom `--text-*`/`--shadow-*`/`--drop-shadow-*` tokens in index.css.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["2xs", "3xs"],
      shadow: ["glow"],
      "drop-shadow": ["glow"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
