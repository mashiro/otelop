import type { ReactNode } from "react";
import { SearchFilter } from "@/components/filters/search-filter";
import { EventWindowControls } from "@/components/common/event-window-controls";

// Passed as ListPanel's toolbarClassName by both trace-list.tsx and
// log-list.tsx, which render this component as ListPanel's toolbar — kept
// alongside it so the grid layout and the content it lays out can't drift
// apart.
export const EVENT_LIST_TOOLBAR_CLASSNAME =
  "grid grid-cols-1 gap-2 @min-[48rem]/list:grid-cols-[minmax(0,1fr)_auto] @min-[48rem]/list:gap-3";

interface EventListToolbarProps {
  searchValue: string;
  onSearchSubmit: (text: string) => string;
  searchPlaceholder: string;
  addFilter: ReactNode;
  tone: "trace" | "log";
}

export function EventListToolbar({
  searchValue,
  onSearchSubmit,
  searchPlaceholder,
  addFilter,
  tone,
}: EventListToolbarProps) {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SearchFilter
          value={searchValue}
          onSubmit={onSearchSubmit}
          placeholder={searchPlaceholder}
          className="min-w-0 max-w-none @min-[48rem]/list:max-w-80"
        />
        {addFilter}
      </div>
      <div className="ml-auto shrink-0">
        <EventWindowControls tone={tone} />
      </div>
    </>
  );
}
