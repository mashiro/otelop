import { useState, useCallback, useRef, useEffect } from "react";
import { copyJsonToClipboard } from "@/lib/export";

export function useCopyJson() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = useCallback(async (data: unknown) => {
    const ok = await copyJsonToClipboard(data);
    if (ok) {
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  return { copied, copy };
}
