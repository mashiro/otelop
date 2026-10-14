import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";

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
    inputRef.current?.focus();
  };

  return (
    <InputGroup className={cn("min-w-40 max-w-80 flex-1", className)}>
      <InputGroupInput
        ref={inputRef}
        aria-label={placeholder}
        aria-keyshortcuts="/"
        title="Focus search with /; press Esc to leave search"
        placeholder={placeholder}
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        {input ? (
          <InputGroupButton
            size="icon-xs"
            aria-label="Clear search"
            title="Clear search"
            onClick={handleClear}
          >
            <X />
          </InputGroupButton>
        ) : (
          <Kbd aria-hidden="true">/</Kbd>
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}
