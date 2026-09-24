import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { themeAtom } from "@/stores/theme";
import { useMediaQuery } from "./use-media-query";

export function useThemeSync() {
  const theme = useAtomValue(themeAtom);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");

  const isDark = theme === "dark" || (theme === "system" && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);
}
