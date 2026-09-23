import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ServerInfoRow } from "./server-info-row";
import type { ServerInfoQuery } from "@/gql/graphql";

export function TablesCard({ storage }: { storage: ServerInfoQuery["status"]["storage"] }) {
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>Tables</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
