import { useState, useRef, useCallback } from "react";
import { useSetAtom } from "jotai";
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
  const setValue = useSetAtom(atom);
  const [input, setInput] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
        className="h-7 w-52 pl-7 pr-7 text-xs"
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
