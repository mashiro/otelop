export function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="text-xs">
      <div className="text-muted-foreground">{k}</div>
      <div className="break-all font-mono text-foreground/80 pl-3">{v}</div>
    </div>
  );
}
