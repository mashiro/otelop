import { Section } from "./detail-field";
import { Item, ItemContent, ItemActions, ItemGroup } from "@/components/ui/item";
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
    <Section title={title} count={entries.length}>
      <ItemGroup variant="inset">
        {entries.map(([k, v]) => (
          <Item
            key={k}
            role="listitem"
            size="inset"
            variant="row"
            className="group/filter-field items-start"
          >
            <ItemContent className="min-w-0">
              <KV k={k} v={typeof v === "string" ? v : (JSON.stringify(v) ?? String(v))} />
            </ItemContent>
            {onFilter && (
              <ItemActions>
                <AddFilterButton
                  label={`Filter ${v == null ? "where absent" : typeof v === "object" ? "where present" : "by"} ${title.toLowerCase()}.${k}`}
                  onClick={() => onFilter(k, v)}
                />
              </ItemActions>
            )}
          </Item>
        ))}
      </ItemGroup>
    </Section>
  );
}
