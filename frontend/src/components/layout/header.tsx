import { Link } from "@tanstack/react-router";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { useAtomValue, useSetAtom } from "jotai";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/common/logo";
import { ServerInfoDialog } from "@/components/layout/server-info-dialog";
import { wsStatusAtom, traceCountAtom, metricCountAtom, logCountAtom } from "@/stores/telemetry";
import { themeAtom, type Theme } from "@/stores/theme";
import { SIGNAL_LIST } from "@/lib/signals";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { color: string; animation: string; label: string }> = {
  connected: {
    color: "bg-success",
    animation: "",
    label: "Connected",
  },
  connecting: {
    color: "bg-warning",
    animation: "animate-pulse-glow",
    label: "Connecting",
  },
  disconnected: {
    color: "bg-destructive",
    animation: "",
    label: "Offline",
  },
};

export function Header() {
  const wsStatus = useAtomValue(wsStatusAtom);
  const traceCount = useAtomValue(traceCountAtom);
  const metricCount = useAtomValue(metricCountAtom);
  const logCount = useAtomValue(logCountAtom);
  const counts = { traces: traceCount, metrics: metricCount, logs: logCount };
  const theme = useAtomValue(themeAtom);
  const setTheme = useSetAtom(themeAtom);

  const status = statusConfig[wsStatus] ?? statusConfig.disconnected;

  return (
    <header className="relative z-10 flex items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3 sm:gap-5">
        <Link
          to="/"
          search={{}}
          className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Logo className="h-7 w-7" />
          <h1 className="sr-only text-base font-semibold tracking-tight sm:not-sr-only">otelop</h1>
        </Link>

        {/* Counters give way first so the header controls stay reachable on narrow screens. */}
        <div className="flex min-w-0 items-center gap-2 overflow-hidden sm:gap-3">
          {SIGNAL_LIST.map((signal) => (
            <Badge key={signal.key} variant="soft" tone={signal.token} size="counter">
              <span className="sr-only">{signal.label}: </span>
              <span aria-hidden="true" className="text-3xs font-bold uppercase tracking-wider">
                {signal.shortLabel}
              </span>
              <span className="font-mono text-xs font-semibold">{counts[signal.key]}</span>
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="mx-2 flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", status.color, status.animation)} />
          <span className="sr-only text-xs font-medium text-muted-foreground sm:not-sr-only">
            {status.label}
          </span>
        </div>

        <ServerInfoDialog />
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </div>
    </header>
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
    <HelpTooltip content={themeLabels[theme]}>
      <Button aria-label={themeLabels[theme]} variant="ghost-muted" size="icon-sm" onClick={next}>
        <Icon />
      </Button>
    </HelpTooltip>
  );
}
