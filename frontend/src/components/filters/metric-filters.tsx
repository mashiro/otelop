import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { metricFiltersAtom } from "@/stores/filters";

const TYPE_OPTIONS = ["Gauge", "Sum", "Histogram", "Summary", "ExponentialHistogram"] as const;

export function MetricFilters() {
  const [filters, setFilters] = useAtom(metricFiltersAtom);
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilters]);

  const toggleType = (type: string) => {
    setFilters((prev) => {
      const next = new Set(prev.type);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, type: next };
    });
  };

  const hasFilters = filters.search || filters.type.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search metrics..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-7 w-48 pl-7 text-xs"
        />
      </div>

      <div className="flex items-center gap-1">
        {TYPE_OPTIONS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggleType(t)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              filters.type.has(t)
                ? "bg-metric/15 text-metric"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setSearchInput("");
            setFilters({ search: "", type: new Set() });
          }}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
