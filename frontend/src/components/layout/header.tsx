import { useAtomValue, useSetAtom } from "jotai";
import { Trash2, Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  wsStatusAtom,
  traceCountAtom,
  metricCountAtom,
  logCountAtom,
  clearAllAtom,
} from "@/stores/telemetry";
import { themeAtom, type Theme } from "@/stores/theme";

const statusConfig: Record<string, { color: string; glow: string; label: string }> = {
  connected: {
    color: "bg-success",
    glow: "animate-breathe",
    label: "Live",
  },
  connecting: {
    color: "bg-warning",
    glow: "animate-pulse-glow",
    label: "Connecting",
  },
  disconnected: {
    color: "bg-destructive",
    glow: "",
    label: "Offline",
  },
};

export function Header() {
  const wsStatus = useAtomValue(wsStatusAtom);
  const traceCount = useAtomValue(traceCountAtom);
  const metricCount = useAtomValue(metricCountAtom);
  const logCount = useAtomValue(logCountAtom);
  const clearAll = useSetAtom(clearAllAtom);
  const theme = useAtomValue(themeAtom);
  const setTheme = useSetAtom(themeAtom);

  const handleClear = async () => {
    await fetch("/api/clear", { method: "DELETE" });
    clearAll();
  };

  const status = statusConfig[wsStatus] ?? statusConfig.disconnected;

  return (
    <header className="relative z-10 flex items-center justify-between border-b border-border/50 px-5 py-3">
      <div className="flex items-center gap-5">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3" stroke="var(--primary)" strokeWidth="1.5" />
              <circle cx="8" cy="8" r="6.5" stroke="var(--primary)" strokeWidth="1" opacity="0.4" />
              <circle cx="8" cy="8" r="1" fill="var(--primary)" />
            </svg>
          </div>
          <h1 className="text-base font-semibold tracking-tight">otelop</h1>
        </div>

        {/* Signal counters */}
        <div className="flex items-center gap-3">
          <CounterBadge label="T" count={traceCount} color="trace" />
          <CounterBadge label="M" count={metricCount} color="metric" />
          <CounterBadge label="L" count={logCount} color="log" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Connection status */}
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${status.color} ${status.glow}`} />
          <span className="text-xs font-medium text-muted-foreground">{status.label}</span>
        </div>

        {/* Theme toggle */}
        <ThemeToggle theme={theme} setTheme={setTheme} />

        {/* Clear button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </header>
  );
}

const counterStyles: Record<string, { wrapper: string; text: string }> = {
  trace: {
    wrapper: "bg-trace/10",
    text: "text-trace",
  },
  metric: {
    wrapper: "bg-metric/10",
    text: "text-metric",
  },
  log: {
    wrapper: "bg-log/10",
    text: "text-log",
  },
};

function CounterBadge({ label, count, color }: { label: string; count: number; color: string }) {
  const style = counterStyles[color] ?? counterStyles.trace;
  return (
    <div className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 ${style.wrapper}`}>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${style.text}`}>
        {label}
      </span>
      <span className={`font-mono text-xs font-semibold ${style.text}`}>{count}</span>
    </div>
  );
}

const themeOrder: Theme[] = ["system", "light", "dark"];
const themeIcons: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};
const themeLabels: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const next = () => {
    const idx = themeOrder.indexOf(theme);
    setTheme(themeOrder[(idx + 1) % themeOrder.length]);
  };
  const Icon = themeIcons[theme];
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={next}
      className="text-muted-foreground hover:text-foreground"
      title={themeLabels[theme]}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
