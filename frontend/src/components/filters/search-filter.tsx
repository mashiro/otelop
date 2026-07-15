import { useState } from "react";
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

  // An external write to the atom (e.g. log-list.tsx's "Show surrounding
  // logs" clearing logSearchAtom) must also update the input. Keep a local
  // value so unfinished IME composition can remain visible without being
  // written to the search atom.
  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    setInput(value);
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) {
      return;
    }

    setValue(input);
  };

  const handleClear = () => {
    setInput("");
    setValue("");
  };

  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
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
