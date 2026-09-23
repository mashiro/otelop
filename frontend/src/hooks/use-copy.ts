import { useState, useCallback, useRef, useEffect } from "react";
import { copyJsonToClipboard, copyTextToClipboard } from "@/lib/export";

function useCopyFeedback<T>(write: (value: T) => Promise<boolean>) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = useCallback(
    async (value: T) => {
      const ok = await write(value);
      if (ok) {
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      }
    },
    [write],
  );

  return { copied, copy };
}

export function useCopyJson() {
  return useCopyFeedback(copyJsonToClipboard);
}

export function useCopyText() {
  return useCopyFeedback(copyTextToClipboard);
}
