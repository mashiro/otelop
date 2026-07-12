import { useState, useRef, useCallback, useEffect } from "react";
import { useAtom } from "jotai";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { PrimitiveAtom } from "jotai";

export function SearchFilter({
  atom,
  placeholder,
}: {
  atom: PrimitiveAtom<string>;
  placeholder: string;
}) {
  const [value, setValue] = useAtom(atom);
  const [lastSyncedValue, setLastSyncedValue] = useState(value);
  const [input, setInput] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // An external write to the atom (e.g. log-list.tsx's "Show surrounding
  // logs" clearing logSearchAtom from outside this component) must reflect
  // into the box, but typing already writes the atom the other way
  // (debounced, local input -> atom) — a useEffect syncing input from value
  // would fight that and violate the project's no-setState-in-useEffect
  // rule. Adjust state during render instead (React's sanctioned pattern for
  // deriving state from a prop that can also change externally): only fires
  // when the atom's value has genuinely diverged from the last one this
  // component synced, so a re-render caused by typing (where value hasn't
  // changed yet) never touches input.
  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    setInput(value);
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setInput(v);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setValue(v), 300);
    },
    [setValue],
  );

  const handleClear = useCallback(() => {
    setInput("");
    clearTimeout(timerRef.current);
    setValue("");
  }, [setValue]);

  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={input}
        onChange={handleChange}
        className="h-7 w-72 pl-7 pr-7 text-xs"
      />
      {input && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
