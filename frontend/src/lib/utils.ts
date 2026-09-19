import { createCn } from "cn/config";

// Teaches the merge engine about the custom tokens declared in index.css's
// `@theme` block. Without this, `shadow-glow`/`drop-shadow-glow` are
// misclassified into the shadow color groups and one class is dropped when
// they're combined with a real color utility (e.g. `shadow-glow` +
// `shadow-trace/20`). Keep this list in sync with the custom
// `--text-*`/`--shadow-*`/`--drop-shadow-*` tokens in index.css.
export const cn = createCn({
  extend: {
    theme: {
      text: ["2xs", "3xs"],
      shadow: ["glow"],
      "drop-shadow": ["glow"],
    },
  },
});
