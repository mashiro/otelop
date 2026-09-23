import { Item, ItemHeader, ItemTitle, ItemContent } from "@/components/ui/item";
import { ServerInfoRow } from "./server-info-row";
import type { ServerInfoQuery } from "@/gql/graphql";

export function TablesCard({ storage }: { storage: ServerInfoQuery["status"]["storage"] }) {
  return (
    <Item variant="muted" className="min-w-0 flex-col items-stretch">
      <ItemHeader className="basis-auto flex-col items-start">
        <ItemTitle>Tables</ItemTitle>
      </ItemHeader>
      <ItemContent>
        <div className="flex flex-col gap-2">
          {storage.tables.map((table) => (
            <ServerInfoRow
              key={table.name}
              label={table.name}
              numeric
              value={
                <>
                  {table.rows.toLocaleString("en-US")}
                  <span className="font-sans text-muted-foreground"> rows</span>
                </>
              }
            />
          ))}
        </div>
      </ItemContent>
    </Item>
  );
}
