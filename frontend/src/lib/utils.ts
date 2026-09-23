import { createCn } from "cn/config";

// Register custom font sizes so merging retains their text colors.
export const cn = createCn({
  extend: {
    theme: {
      text: ["2xs", "3xs"],
      shadow: ["glow"],
    },
  },
});
