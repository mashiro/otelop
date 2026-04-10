import { useEffect, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { themeAtom } from "@/stores/theme";

const darkMq = window.matchMedia("(prefers-color-scheme: dark)");

function subscribe(cb: () => void) {
  darkMq.addEventListener("change", cb);
  return () => darkMq.removeEventListener("change", cb);
}

function getSystemDark() {
  return darkMq.matches;
}

function useSystemDark() {
  return useSyncExternalStore(subscribe, getSystemDark);
}

export function useThemeSync() {
  const theme = useAtomValue(themeAtom);
  const systemDark = useSystemDark();

  const isDark = theme === "dark" || (theme === "system" && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);
}
