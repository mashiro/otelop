import { useState, useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { logFiltersAtom } from "@/stores/filters";
import { logTraceFilterAtom } from "@/stores/telemetry";

const SEVERITY_OPTIONS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;

const severityColors: Record<string, string> = {
  ERROR: "bg-destructive/15 text-destructive",
  FATAL: "bg-destructive/15 text-destructive",
  WARN: "bg-warning/15 text-warning",
  INFO: "bg-trace/15 text-trace",
  DEBUG: "bg-muted text-muted-foreground",
  TRACE: "bg-muted text-muted-foreground",
};

export function LogFilters() {
  const [filters, setFilters] = useAtom(logFiltersAtom);
  const traceFilter = useAtomValue(logTraceFilterAtom);
  const setTraceFilter = useSetAtom(logTraceFilterAtom);
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilters]);

  const toggleSeverity = (sev: string) => {
    setFilters((prev) => {
      const next = new Set(prev.severity);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return { ...prev, severity: next };
    });
  };

  const hasFilters = filters.search || filters.severity.size > 0 || filters.service;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2">
      {traceFilter && (
        <div className="flex items-center gap-1 rounded bg-trace/10 px-2 py-0.5 text-[11px] text-trace">
          <span className="font-mono">{traceFilter.slice(0, 12)}...</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setTraceFilter(null)}
            className="h-4 w-4 text-trace hover:text-foreground"
          >
            <X className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search body..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-7 w-40 pl-7 text-xs"
        />
      </div>

      <div className="flex items-center gap-1">
        {SEVERITY_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggleSeverity(s)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              filters.severity.has(s)
                ? severityColors[s]
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
            setFilters({ search: "", severity: new Set(), service: "" });
          }}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
