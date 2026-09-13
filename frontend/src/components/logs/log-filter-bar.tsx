import { useId, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Filter, Pause, Play, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { logsAtom } from "@/stores/telemetry";
import { logQueryStateAtom, newLogFilter } from "@/stores/log-query";
import { cn } from "@/lib/utils";
import {
  logFilterOperators,
  filterDraft,
  filterDraftError,
  draftTerm,
  type LogFilterOperator,
} from "@/lib/log-filter";
import { logFields, logTermValue, type LogSearchTerm } from "@/lib/log-search";
import type { LogData } from "@/types/telemetry";

export function LogFilterBar() {
  const [state, setState] = useAtom(logQueryStateAtom);
  const logs = useAtomValue(logsAtom);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const keys = [
    ...Object.keys(logFields),
    ...new Set(
      logs.flatMap((log) => [
        ...Object.keys(log.attributes).map((key) => `attributes.${key}`),
        ...Object.keys(log.resource).map((key) => `resource.${key}`),
      ]),
    ),
  ].sort();

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Log filters">
      <Popover open={adding} onOpenChange={setAdding}>
        <PopoverTrigger render={<Button variant="outline" size="sm" />}>
          <Plus data-icon="inline-start" /> Add filter
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] gap-4 p-4">
          <PopoverHeader>
            <PopoverTitle>Add filter</PopoverTitle>
            <PopoverDescription>Choose a key, an operator, and a value.</PopoverDescription>
          </PopoverHeader>
          <FilterEditor
            keys={keys}
            logs={logs}
            onCancel={() => setAdding(false)}
            onApply={(term) => {
              setState((current) => ({
                ...current,
                filters: [...current.filters, newLogFilter(term)],
              }));
              setAdding(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {state.filters.length > 1 && <span className="text-xs text-muted-foreground">Match all</span>}
      {state.filters.map((filter) => {
        const draft = filterDraft(filter);
        const operatorLabel = logFilterOperators.find(
          (operator) => operator.value === draft.operator,
        )?.label;
        return (
          <div
            key={filter.id}
            className={cn(
              "flex h-7 min-w-0 max-w-full items-center rounded-md border border-border bg-muted",
              !filter.enabled && "bg-background text-muted-foreground",
            )}
          >
            <Popover
              open={editing === filter.id}
              onOpenChange={(open) => setEditing(open ? filter.id : null)}
            >
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-full min-w-0 gap-1.5 rounded-r-none"
                  />
                }
                aria-label={`Edit filter ${draft.key}`}
                title={draft.key}
              >
                <Filter data-icon="inline-start" className="text-muted-foreground" />
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 text-xs",
                    !filter.enabled && "line-through",
                  )}
                >
                  <span className="truncate font-mono">
                    {filter.resource ? "resource." : ""}
                    {filter.key}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{operatorLabel}</span>
                  {draft.value && (
                    <span className="max-w-40 truncate font-medium">{draft.value}</span>
                  )}
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] gap-4 p-4">
                <PopoverHeader>
                  <PopoverTitle>Edit filter</PopoverTitle>
                </PopoverHeader>
                <FilterEditor
                  initial={filter}
                  keys={keys}
                  logs={logs}
                  onCancel={() => setEditing(null)}
                  onApply={(term) => {
                    setState((current) => ({
                      ...current,
                      filters: current.filters.map((item) =>
                        item.id === filter.id ? { ...item, ...term } : item,
                      ),
                    }));
                    setEditing(null);
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${filter.enabled ? "Disable" : "Enable"} filter ${draft.key}`}
              aria-pressed={filter.enabled}
              title={filter.enabled ? "Disable filter" : "Enable filter"}
              onClick={() =>
                setState((current) => ({
                  ...current,
                  filters: current.filters.map((item) =>
                    item.id === filter.id ? { ...item, enabled: !item.enabled } : item,
                  ),
                }))
              }
            >
              {filter.enabled ? <Pause /> : <Play />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove filter ${draft.key}`}
              title="Remove filter"
              className="mr-0.5"
              onClick={() =>
                setState((current) => ({
                  ...current,
                  filters: current.filters.filter((item) => item.id !== filter.id),
                }))
              }
            >
              <X />
            </Button>
          </div>
        );
      })}
      {state.filters.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={() => setState((current) => ({ ...current, filters: [] }))}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

function FilterEditor({
  initial,
  keys,
  logs,
  onApply,
  onCancel,
}: {
  initial?: LogSearchTerm;
  keys: string[];
  logs: LogData[];
  onApply: (term: LogSearchTerm) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => filterDraft(initial));
  const [submitted, setSubmitted] = useState(false);
  const id = useId();
  const error = filterDraftError(draft);
  const noValue = draft.operator === "exists" || draft.operator === "not_exists";
  const term = draftTerm(draft);
  const values = [
    ...new Set(
      logs.flatMap((log) => {
        const value = logTermValue(log, term);
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? [String(value)]
          : [];
      }),
    ),
  ]
    .sort()
    .slice(0, 100);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (!error) onApply(draftTerm(draft));
      }}
    >
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-key`}>Key</FieldLabel>
          <Input
            id={`${id}-key`}
            list={`${id}-keys`}
            value={draft.key}
            placeholder="attributes.http.status_code"
            className="font-mono text-xs"
            onChange={(event) => setDraft({ ...draft, key: event.target.value })}
            autoComplete="off"
          />
          <datalist id={`${id}-keys`}>
            {keys.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-operator`}>Operator</FieldLabel>
          <Select
            value={draft.operator}
            onValueChange={(value) => {
              if (value) setDraft({ ...draft, operator: value as LogFilterOperator });
            }}
            items={logFilterOperators}
          >
            <SelectTrigger id={`${id}-operator`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {logFilterOperators.map((operator) => (
                  <SelectItem key={operator.value} value={operator.value}>
                    {operator.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-value`}>Value</FieldLabel>
          <Input
            id={`${id}-value`}
            list={`${id}-values`}
            value={noValue ? "" : draft.value}
            disabled={noValue}
            placeholder={noValue ? "Not required" : "Enter or choose a value"}
            onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            autoComplete="off"
          />
          <datalist id={`${id}-values`}>
            {values.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </Field>
      </FieldGroup>
      {submitted && error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          {initial ? "Apply changes" : "Add filter"}
        </Button>
      </div>
    </form>
  );
}
