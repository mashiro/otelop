import { useState, useRef, useEffect } from "react";

// write reports whether the clipboard accepted the value, so the "copied"
// feedback only shows for a copy that actually happened.
export function useCopy<T>(write: (value: T) => Promise<boolean>) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async (value: T) => {
    if (await write(value)) {
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  return { copied, copy };
}
