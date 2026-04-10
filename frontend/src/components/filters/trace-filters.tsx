import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { traceFiltersAtom } from "@/stores/filters";

const STATUS_OPTIONS = ["Ok", "Error", "Unset"] as const;

export function TraceFilters() {
  const [filters, setFilters] = useAtom(traceFiltersAtom);
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilters]);

  const toggleStatus = (status: string) => {
    setFilters((prev) => {
      const next = new Set(prev.status);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return { ...prev, status: next };
    });
  };

  const hasFilters =
    filters.search ||
    filters.status.size > 0 ||
    filters.durationMin !== null ||
    filters.durationMax !== null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search traces..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-7 w-48 pl-7 text-xs"
        />
      </div>

      <div className="flex items-center gap-1">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggleStatus(s)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              filters.status.has(s)
                ? s === "Error"
                  ? "bg-destructive/15 text-destructive"
                  : s === "Ok"
                    ? "bg-success/15 text-success"
                    : "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setSearchInput("");
            setFilters({ search: "", status: new Set(), durationMin: null, durationMax: null });
          }}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
