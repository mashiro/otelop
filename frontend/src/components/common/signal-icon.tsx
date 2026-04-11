import type { SignalConfig } from "@/lib/signals";

interface SignalIconProps {
  signal: SignalConfig;
  size?: number;
  className?: string;
}

export function SignalIcon({ signal, size = 28, className }: SignalIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={`var(${signal.cssVar})`}
      strokeWidth="1.5"
      className={className}
    >
      {signal.iconPaths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
