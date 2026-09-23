import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function SearchFilter({
  value,
  onSubmit,
  placeholder,
  className,
}: {
  value: string;
  onSubmit: (text: string) => string;
  placeholder: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useKeyboardShortcut("/", () => inputRef.current?.focus());

  const [lastSyncedValue, setLastSyncedValue] = useState(value);
  const [input, setInput] = useState(value);

  // Keep unfinished IME composition local while reflecting URL changes.
  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    setInput(value);
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur();
      return;
    }
    if (e.key !== "Enter") {
      return;
    }

    setInput(onSubmit(input));
  };

  const handleClear = () => {
    setInput("");
    onSubmit("");
  };

  return (
    <div className={cn("relative min-w-40 max-w-80 flex-1", className)}>
      <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        aria-label={placeholder}
        aria-keyshortcuts="/"
        title="Focus search with /; press Esc to leave search"
        placeholder={placeholder}
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="pl-7 pr-7"
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
