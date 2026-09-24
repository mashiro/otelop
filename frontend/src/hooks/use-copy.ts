import { useState, useRef, useEffect } from "react";

export type CopyStatus = "idle" | "copied" | "failed";

// write reports whether the clipboard accepted the value, so a failed copy
// (e.g. no clipboard API on a non-secure http origin) is shown as such
// instead of silently doing nothing.
export function useCopy<T>(write: (value: T) => Promise<boolean>) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  const copy = async (value: T) => {
    const ok = await write(value);
    // The write can outlive the component (e.g. the dialog closes while a
    // clipboard permission prompt is open); cleanup has already run then.
    if (!mountedRef.current) return;
    setStatus(ok ? "copied" : "failed");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus("idle"), 2000);
  };

  return { status, copy };
}
