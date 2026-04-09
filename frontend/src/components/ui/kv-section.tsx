import { KV } from "./kv";

interface Props {
  title: string;
  data: Record<string, unknown>;
}

export function KVSection({ title, data }: Props) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5">
        {entries.map(([k, v]) => (
          <KV key={k} k={k} v={String(v)} />
        ))}
      </div>
    </div>
  );
}
