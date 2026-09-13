import { KV } from "./kv";
import { AddFilterButton } from "@/components/filters/add-filter-button";

interface Props {
  title: string;
  data: Record<string, unknown>;
  onFilter?: (key: string, value: unknown) => void;
}

export function KVSection({ title, data, onFilter }: Props) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5">
        {entries.map(([k, v]) =>
          onFilter ? (
            <div key={k} className="group/filter-field flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <KV k={k} v={typeof v === "string" ? v : JSON.stringify(v)} />
              </div>
              {onFilter && (
                <AddFilterButton
                  label={`Filter ${v == null ? "where absent" : typeof v === "object" ? "where present" : "by"} ${title.toLowerCase()}.${k}`}
                  onClick={() => onFilter(k, v)}
                />
              )}
            </div>
          ) : (
            <KV key={k} k={k} v={String(v)} />
          ),
        )}
      </div>
    </div>
  );
}
