import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
    <Card size="flush">
      <Accordion defaultValue={["values"]}>
        <AccordionItem value="values">
          <div className="px-3">
            <AccordionTrigger className="items-center">
              <div className="flex items-center gap-2">
                <span>{title}</span>
                <Badge variant="secondary">{entries.length}</Badge>
              </div>
            </AccordionTrigger>
          </div>
          <AccordionContent>
            <ItemGroup variant="divided">
              {entries.map(([k, v]) => (
                <Item
                  key={k}
                  role="listitem"
                  size="sm"
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
