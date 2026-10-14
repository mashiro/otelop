import { Info } from "lucide-react";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { Link } from "@tanstack/react-router";
import { spanLinkSelection } from "@/lib/span-link-selection";
import { useSpanLinks } from "@/hooks/use-span-links";
import type { LinkPageFragment } from "@/gql/graphql";
import type { SpanData } from "@/types/telemetry";
import { shortId } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LoadMoreRow } from "@/components/common/load-more-row";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Item,
  ItemGroup,
  ItemHeader,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

export function SpanLinks({ span, incoming }: { span: SpanData; incoming: boolean }) {
  const query = useSpanLinks(span.traceId, span.spanId, incoming);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (query.data?.pages[0]?.available === false) {
    return (
      <p className="text-sm text-muted-foreground">The selected span is no longer available.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {span.droppedLinksCount > 0 && !incoming && (
        <p className="text-xs text-muted-foreground">
          {span.droppedLinksCount} links dropped by the sender.
        </p>
      )}
      {query.isPending && <Skeleton className="h-16 w-full" />}
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load links.{" "}
            <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!query.isPending && !query.isError && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {incoming ? "No retained spans reference this span." : "No links recorded."}
        </p>
      )}
      {items.length > 0 && (
        <ItemGroup>
          {items.map((link) => (
            <SpanLinkItem
              key={`${link.sourceTraceId}/${link.sourceSpanId}/${link.ordinal}`}
              link={link}
              incoming={incoming}
            />
          ))}
        </ItemGroup>
      )}
      <LoadMoreRow
        visible={!!query.hasNextPage && !query.isError}
        loadingMore={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}

function SpanLinkItem({
  link,
  incoming,
}: {
  link: LinkPageFragment["items"][number];
  incoming: boolean;
}) {
  const other = incoming ? link.source : link.target;
  const traceId = incoming ? link.sourceTraceId : link.traceId;
  const spanId = incoming ? link.sourceSpanId : link.spanId;
  return (
    <Item variant="muted" size="xs" role="listitem" className="min-w-0">
      <ItemHeader>
        {other ? (
          <Link
            to="/traces/$traceId/spans/$spanId"
            params={{ traceId, spanId }}
            search={(previous) => ({ ...previous, spanTab: undefined, link: undefined })}
            className="group/link flex min-w-0 w-full items-center justify-between gap-2 rounded-sm text-foreground hover:text-foreground focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <ItemContent className="min-w-0">
              <ItemTitle className="max-w-full">
                <span className="break-words group-hover/link:underline">{other.name}</span>
              </ItemTitle>
              <ItemDescription>{other.serviceName || "Unknown service"}</ItemDescription>
            </ItemContent>
          </Link>
        ) : (
          <ItemTitle>
            {!incoming && link.targetStatus === "INVALID_CONTEXT"
              ? "Invalid span context"
              : "Span not available"}
          </ItemTitle>
        )}
        <ItemActions>
          <HelpTooltip content="Link info">
            <Button
              nativeButton={false}
              role="link"
              variant="ghost-muted"
              size="icon-sm"
              aria-label="Link info"
              render={
                <Link
                  to="."
                  search={(previous) => ({ ...previous, link: spanLinkSelection(link) })}
                  resetScroll={false}
                  id={`span-link-${spanLinkSelection(link)}`}
                />
              }
            >
              <Info />
            </Button>
          </HelpTooltip>
        </ItemActions>
      </ItemHeader>
      <p
        className="flex min-w-0 basis-full flex-wrap gap-x-2 font-mono text-2xs text-muted-foreground"
        title={`Trace ${traceId || "(empty)"}\nSpan ${spanId || "(empty)"}`}
      >
        <span>#{link.ordinal + 1}</span>
        <span>Trace {traceId ? shortId(traceId) : "(empty)"}</span>
        <span>Span {spanId ? shortId(spanId) : "(empty)"}</span>
      </p>
    </Item>
  );
}
