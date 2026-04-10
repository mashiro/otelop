import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import { Search } from "lucide-react";
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
  const [input, setInput] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setValue(input), 300);
    return () => clearTimeout(timer);
  }, [input, setValue]);

  // Sync external resets (e.g. clear all)
  useEffect(() => {
    if (!value && input) setInput("");
  }, [value, input]);

  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="h-7 w-52 pl-7 text-xs"
      />
    </div>
  );
}
