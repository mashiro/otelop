import { ArrowRight, ChevronRight, Link2, List, Braces } from "lucide-react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { SpanLinkQuery } from "@/gql/graphql";
import { parseSpanLink, spanLinkSelection, type SpanLinkIdentity } from "@/lib/span-link-selection";
import { useSpanLink } from "@/hooks/use-span-link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyJsonButton } from "@/components/common/copy-json-button";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemGroup,
} from "@/components/ui/item";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";

export function SpanLinkDialog() {
  const link = useSearch({ strict: false, select: (search) => search.link });
  const identity = parseSpanLink(link);
  return identity ? <LinkDialog key={spanLinkSelection(identity)} identity={identity} /> : null;
}

function LinkDialog({ identity }: { identity: SpanLinkIdentity }) {
  const query = useSpanLink(identity);
  const navigate = useNavigate();
  const link = query.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          void navigate({
            to: ".",
            search: (previous) => ({ ...previous, link: undefined }),
            replace: true,
            resetScroll: false,
          });
      }}
    >
      <DialogContent
        size="wide"
        className="flex flex-col"
        finalFocus={() => document.getElementById(`span-link-${spanLinkSelection(identity)}`)}
      >
        <DialogHeader className="mr-8">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
            <DialogTitle>SpanLink</DialogTitle>
            <Badge variant="secondary">#{identity.ordinal + 1}</Badge>
            {link && (
              <div className="ml-auto">
                <CopyJsonButton data={link} />
              </div>
            )}
          </div>
          <DialogDescription className="sr-only">
            Attributes and context recorded on this link.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto">
          {query.isPending && <Skeleton className="h-32 w-full" />}
          {query.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                Could not load this link.
                <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {query.isSuccess && !link && <p>This SpanLink is no longer available.</p>}
          {link && <LinkInformation link={link} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type LinkData = NonNullable<SpanLinkQuery["spanLink"]>;

function LinkInformation({ link }: { link: LinkData }) {
  return (
    <>
      <ItemGroup>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          <Endpoint
            label="Source span"
            span={link.source}
            traceId={link.sourceTraceId}
            spanId={link.sourceSpanId}
          />
          <ArrowRight
            aria-label="references"
            className="size-4 justify-self-center text-muted-foreground rotate-90 sm:hidden"
          />
          <Endpoint
            referenced
            label="Referenced span"
            span={link.target}
            traceId={link.traceId}
            spanId={link.spanId}
          />
        </div>
      </ItemGroup>
      <section className="flex flex-col gap-2" aria-label="Link attributes">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <List className="size-4 text-muted-foreground" aria-hidden="true" />
          Link attributes
        </h3>
        <div className="overflow-hidden rounded-lg border">
          {Object.keys(link.attributes).length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>No attributes recorded on this link.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table aria-label="Link attributes" className="table-fixed">
              <TableBody>
                {Object.entries(link.attributes).map(([key, value]) => (
                  <Attribute key={key} name={key} value={value} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
      <section className="flex flex-col gap-2" aria-label="Recorded link context">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Braces className="size-4 text-muted-foreground" aria-hidden="true" />
          Recorded link context
        </h3>
        <div className="overflow-hidden rounded-lg border">
          <Table aria-label="Recorded link context" className="table-fixed">
            <TableBody>
              <Attribute name="Trace state" value={link.traceState ?? "Unknown"} />
              <Attribute name="Flags" value={link.flags ?? "Unknown"} />
              <Attribute name="Dropped attributes" value={link.droppedAttributesCount} />
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}

function Endpoint({
  label,
  referenced = false,
  span,
  traceId,
  spanId,
}: {
  label: string;
  referenced?: boolean;
  span: LinkData["source"];
  traceId: string;
  spanId: string;
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:row-span-3 sm:grid-rows-subgrid" role="listitem">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="relative flex">
        {referenced && (
          <ArrowRight
            aria-label="references"
            className="absolute top-1/2 -left-6 hidden size-4 -translate-y-1/2 text-muted-foreground sm:block"
          />
        )}
        <Item
          variant="muted"
          size="xs"
          render={
            span ? (
              <Link
                to="/traces/$traceId/spans/$spanId"
                params={{ traceId: span.traceId, spanId: span.spanId }}
                search={(previous) => ({ ...previous, spanTab: undefined, link: undefined })}
                aria-label={span.name}
              />
            ) : undefined
          }
        >
          <ItemContent className="min-w-0">
            <ItemTitle>
              <span className="min-w-0 break-words">{span?.name ?? "Span not available"}</span>
            </ItemTitle>
            <ItemDescription>
              {span ? span.serviceName || "Unknown service" : "Span details unavailable"}
            </ItemDescription>
          </ItemContent>
          {span && (
            <ItemActions>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </ItemActions>
          )}
        </Item>
      </div>
      <dl className="grid grid-cols-6 gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Trace</dt>
        <dd className="col-span-5 break-all font-mono text-2xs">{traceId || "(empty)"}</dd>
        <dt className="text-muted-foreground">Span</dt>
        <dd className="col-span-5 break-all font-mono text-2xs">{spanId || "(empty)"}</dd>
      </dl>
    </div>
  );
}

function Attribute({ name, value }: { name: string; value: unknown }) {
  return (
    <TableRow>
      <TableCell emphasis="muted" className="w-2/5 align-top whitespace-normal break-words">
        {name}
      </TableCell>
      <TableCell variant="mono" className="align-top whitespace-pre-wrap break-all">
        {typeof value === "string" ? value || "(empty)" : JSON.stringify(value, null, 2)}
      </TableCell>
    </TableRow>
  );
}
