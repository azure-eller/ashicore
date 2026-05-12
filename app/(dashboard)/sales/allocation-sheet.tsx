"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Cancel01Icon,
  Factory01Icon,
  PackageIcon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { apiJson } from "@/lib/client/api";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  SalesAllocationSheetData,
  SalesAllocationSource,
  SalesAllocationSourceType,
} from "./types";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";

type AllocationDraft = Record<string, string>;
type AllocationDraftState = {
  lineId: string | null;
  values: Record<string, AllocationDraft>;
};

type AllocationTokenData = {
  sourceKey: string;
  sourceType: SalesAllocationSourceType;
  sourceId: string | null;
  sourceLabel: string;
  sourceIndex: number;
  quantity: number;
  originLineId?: string;
};

type OutputAllocationData = {
  sourceMo: {
    id: string;
    orderNumber: string;
    productName: string;
    plannedQuantity: string;
    actualQuantity: string;
    status: string;
  };
  productionDestinations: Array<{
    ingredientId: string;
    manufacturingOrderId: string;
    orderNumber: string;
    productName: string;
    outputProductName?: string;
    outputPlannedQuantity?: string;
    outputUnitName?: string;
    plannedDate?: string | null;
    salesOrderNumber?: string | null;
    salesCustomerName?: string | null;
    status: string;
    remainingNeed: string;
    assignedQty: string;
    shortQty: string;
  }>;
  assignedSalesQty: string;
  assignedProductionQty: string;
  unassignedQty: string;
};

type Props = {
  lineId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTargetLineChange: (lineId: string) => void;
  outputManufacturingOrderId?: string | null;
  onOutputManufacturingOrderChange?: (id: string | null) => void;
};

type CarryState = AllocationTokenData | null;

function allocationKey(sourceType: SalesAllocationSourceType, sourceId: string | null) {
  return `${sourceType}:${sourceId ?? "stock_pool"}`;
}

function parseAllocationKey(key: string) {
  const [sourceType, rawSourceId] = key.split(":") as [
    SalesAllocationSourceType,
    string,
  ];
  return {
    sourceType,
    sourceId: rawSourceId === "stock_pool" ? null : rawSourceId,
  };
}

function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function toQuantityString(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function readQuantity(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayDateString() {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function shortLabel(value: number) {
  return value > 0 ? formatQuantity(toQuantityString(value)) : "\u2014";
}

function clampQuantity(value: number, max: number) {
  return Math.max(0, Math.min(readQuantity(toQuantityString(value)), max));
}

function sourceKindLabel(source: SalesAllocationSource) {
  if (source.sourceType === "stock_pool") return "Stock";
  if (source.sourceType === "lot") return "Lot";
  return source.status === "draft" ? "Draft production" : "Released production";
}

function formatInstantDate(value: string | null | undefined, organizationTimeZone: string) {
  if (!value) return "\u2014";
  return formatDateTime(value, organizationTimeZone).split(",")[0] ?? "\u2014";
}

function ProgressBar({
  value,
  max,
  tone = "success",
}: {
  value: number;
  max: number;
  tone?: "success" | "primary" | "warning";
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-sm bg-muted">
      <div
        className={cn(
          "h-full rounded-sm transition-all",
          tone === "success" && "bg-success",
          tone === "primary" && "bg-primary",
          tone === "warning" && "bg-warning"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SectionTitle({
  title,
  count,
  icon,
}: {
  title: string;
  count?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <div className="flex items-center gap-2">
        {icon}
        <span>{title}</span>
      </div>
      {count ? <span className="font-medium normal-case tracking-normal">{count}</span> : null}
    </div>
  );
}

function WorkspacePanel({
  title,
  count,
  accent = "default",
  children,
  footer,
  className,
}: {
  title: string;
  count?: string;
  accent?: "default" | "supply" | "production";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-[34rem] flex-col overflow-hidden rounded-lg border bg-card shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-[2px]",
              accent === "supply" && "bg-success shadow-md",
              accent === "production" && "bg-primary shadow-md",
              accent === "default" && "bg-warning shadow-md"
            )}
          />
          <h3 className="truncate text-sm font-semibold uppercase tracking-wide">
            {title}
          </h3>
        </div>
        {count ? (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {children}
      </div>
      {footer ? <div className="border-t bg-muted/20 p-3">{footer}</div> : null}
    </section>
  );
}

function CarryPanel({
  carried,
  onClear,
  className,
}: {
  carried: CarryState;
  onClear: () => void;
  className?: string;
}) {
  if (!carried) return null;

  return (
    <TooltipProvider>
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 z-20 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2",
          className
        )}
      >
        <div className="pointer-events-auto rounded-lg border bg-popover/95 p-3 text-popover-foreground shadow-xl ring-1 ring-primary/15 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                Picked up
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {formatQuantity(toQuantityString(carried.quantity))}
                </Badge>
                <span className="truncate text-sm font-medium">{carried.sourceLabel}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">H</kbd>
              <span>split</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">+/-</kbd>
              <span>adjust</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Esc</kbd>
              <span>clear</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" onClick={onClear}>
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                    <span className="sr-only">Clear carried allocation</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Esc clears the carried quantity.</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SupplyStack({
  source,
  sourceKeyValue,
  sourceIndex,
  previewFree,
  isSelected,
  onPick,
  onOpenOutput,
}: {
  source: SalesAllocationSource;
  sourceKeyValue: string;
  sourceIndex: number;
  previewFree: number;
  isSelected: boolean;
  onPick: (token: AllocationTokenData) => void;
  onOpenOutput: (id: string) => void;
}) {
  const isMo = source.sourceType === "manufacturing_order";
  const isLot = source.sourceType === "lot";
  const quantityLabel = formatQuantity(toQuantityString(previewFree));
  const canPick = previewFree > 0 && source.canAllocate;
  const stackClassName = cn(
    "group relative flex h-28 w-24 flex-col justify-between rounded-md border bg-background p-2 text-left shadow-xs transition",
    "hover:border-primary/40 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-ring",
    isSelected && "border-primary/60 bg-primary/5 ring-2 ring-primary/25 shadow-md",
    isMo && "border-primary/35 bg-primary/5",
    !canPick && "opacity-70"
  );

  if (isMo) {
    return (
      <div className={stackClassName}>
        <button
          type="button"
          className="flex items-start justify-between gap-2 text-left focus-visible:outline-none"
          onClick={() => {
            if (!canPick) return;
            onPick({
              sourceKey: sourceKeyValue,
              sourceType: source.sourceType,
              sourceId: source.sourceId,
              sourceLabel: source.label,
              sourceIndex,
              quantity: previewFree,
            });
          }}
          disabled={!canPick}
          aria-label={`Allocate all from ${source.label}`}
        >
          <span className="inline-flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <HugeiconsIcon icon={Factory01Icon} strokeWidth={2} className="size-4" />
          </span>
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {quantityLabel}
          </span>
        </button>
        <div className="min-w-0">
          <button
            type="button"
            className="block max-w-full truncate text-xs font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              if (source.sourceId) onOpenOutput(source.sourceId);
            }}
            aria-label={`Open output allocation for ${source.label}`}
          >
            {source.label}
          </button>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {statusLabel(source.status)}
            {source.date ? ` · ${formatDate(source.date)}` : ""}
          </div>
        </div>
        {source.sourceId ? (
          <button
            type="button"
            className="text-left text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onOpenOutput(source.sourceId!)}
          >
            Open output
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(stackClassName, "focus-visible:outline-none focus-visible:ring-2")}
      onClick={() => {
        if (!canPick) return;
        onPick({
          sourceKey: sourceKeyValue,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceLabel: source.label,
          sourceIndex,
          quantity: previewFree,
        });
      }}
      aria-label={`Allocate all from ${source.label}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="inline-flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground"
        >
          <HugeiconsIcon icon={PackageIcon} strokeWidth={2} className="size-4" />
        </span>
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {quantityLabel}
        </span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold">
          {isLot ? source.lotNumber ?? source.label : source.label}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {isMo
            ? `${statusLabel(source.status)}${source.date ? ` · ${formatDate(source.date)}` : ""}`
            : source.date
              ? `Received ${formatDate(source.date)}`
              : sourceKindLabel(source)}
        </div>
      </div>
    </button>
  );
}

function SourceDetailPanel({
  source,
  destinations,
}: {
  source: SalesAllocationSource | null;
  destinations: Array<{ label: string; quantity: number; kind: "sales" | "production" }>;
}) {
  const organizationTimeZone = useOrganizationTimeZone();

  if (!source) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-3 text-sm text-muted-foreground">
        Select a stack to inspect allocation details.
      </div>
    );
  }

  const total = readQuantity(source.totalQty);
  const allocated = readQuantity(source.allocatedQty);
  const free = readQuantity(source.freeQty);

  return (
    <div className="rounded-md border bg-background p-3 shadow-xs">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={source.sourceType === "manufacturing_order" ? Factory01Icon : PackageIcon}
              strokeWidth={2}
              className="size-4 text-muted-foreground"
            />
            <h3 className="truncate text-sm font-semibold">{source.label}</h3>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {source.sourceType === "lot" ? (
              <>
                Received {formatInstantDate(source.receivedAt ?? source.date, organizationTimeZone)} · Created{" "}
                {formatInstantDate(source.createdAt, organizationTimeZone)}
              </>
            ) : source.sourceType === "manufacturing_order" ? (
              <>
                {statusLabel(source.status)}
                {source.date ? ` · ${formatDate(source.date)}` : ""}
              </>
            ) : (
              "Available stock pool"
            )}
          </div>
        </div>
        <Badge variant="secondary">{sourceKindLabel(source)}</Badge>
      </div>

      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Allocated</span>
          <ProgressBar value={allocated} max={Math.max(total, allocated + free)} tone="warning" />
          <span className="text-right font-medium tabular-nums">{formatQuantity(source.allocatedQty)}</span>
        </div>
        <div className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Free</span>
          <ProgressBar value={free} max={Math.max(total, allocated + free)} />
          <span className="text-right font-medium tabular-nums">{formatQuantity(source.freeQty)}</span>
        </div>
      </div>

      <div className="mt-3 border-t pt-3">
        {destinations.length === 0 ? (
          <div className="text-sm text-muted-foreground">No allocations from this source.</div>
        ) : (
          <div className="space-y-1">
            {destinations.map((destination) => (
              <div
                key={`${destination.kind}:${destination.label}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate text-muted-foreground">
                  {destination.kind === "production" ? "Production" : "Sales"} ·{" "}
                  {destination.label}
                </span>
                <span className="font-medium tabular-nums">
                  {formatQuantity(toQuantityString(destination.quantity))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DemandCard({
  row,
  isTarget,
  allocatedQty,
  shortQty,
  carried,
  children,
  onPlace,
}: {
  row: SalesAllocationSheetData["demandRows"][number];
  isTarget: boolean;
  allocatedQty: number;
  shortQty: number;
  carried: CarryState;
  children?: ReactNode;
  onPlace: () => void;
}) {
  const remaining = readQuantity(row.remainingQty);
  const canPlace = carried != null && shortQty > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Allocate to ${row.orderNumber}`}
      data-testid={isTarget ? "current-allocation-bucket" : "readonly-allocation-bucket"}
      className={cn(
        "cursor-pointer",
        "w-full rounded-md border bg-background p-3 text-left shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isTarget && "border-primary/25 bg-primary/5",
        canPlace && "hover:border-primary/50 hover:bg-primary/5"
      )}
      onClick={onPlace}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlace();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Badge variant="secondary" className="rounded-sm">SO</Badge>
            <span>{row.orderNumber}</span>
            <span className="truncate text-muted-foreground">{row.customerName}</span>
            {isTarget ? <Badge variant="outline">This order</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Ship {row.shipDate ? formatDate(row.shipDate) : "\u2014"} · {row.itemName}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{formatQuantity(row.remainingQty)} needed</div>
          <div>{row.unitName}</div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: Math.min(12, Math.max(1, Math.ceil(remaining / 25))) }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "flex size-7 items-center justify-center rounded border",
                index < Math.ceil(allocatedQty / 25)
                  ? "border-border bg-muted"
                  : "border-dashed bg-transparent"
              )}
            >
              {index < Math.ceil(allocatedQty / 25) ? (
                <HugeiconsIcon icon={PackageIcon} strokeWidth={2} className="size-3.5 text-muted-foreground" />
              ) : null}
            </span>
          ))}
          {remaining > 300 ? (
            <span className="flex size-7 items-center justify-center text-xs text-muted-foreground">+</span>
          ) : null}
        </div>
        <ProgressBar value={allocatedQty} max={remaining} />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">{children}</div>
          <div className="flex gap-4">
            <span>
              <span className="text-muted-foreground">Allocated </span>
              <span className="font-medium text-success">{formatQuantity(toQuantityString(allocatedQty))}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Short </span>
              <span className={cn("font-medium", shortQty > 0 && "text-destructive")}>
                {shortLabel(shortQty)}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AllocationChip({
  label,
  quantity,
  onPick,
}: {
  label: string;
  quantity: number;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onPick();
      }}
      className="inline-flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-xs transition hover:border-primary/40 hover:bg-primary/5"
      aria-label={`Move ${formatQuantity(toQuantityString(quantity))} from ${label}`}
    >
      <HugeiconsIcon icon={PackageIcon} strokeWidth={2} className="size-3.5 text-muted-foreground" />
      <span className="max-w-28 truncate">{label}</span>
      <span className="tabular-nums">{formatQuantity(toQuantityString(quantity))}</span>
    </button>
  );
}

function OutputAllocationWorkspace({
  manufacturingOrderId,
  onBack,
  onOpenOutput,
}: {
  manufacturingOrderId: string;
  onBack: () => void;
  onOpenOutput: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
  const [carriedQty, setCarriedQty] = useState<number | null>(null);
  const [draftState, setDraftState] = useState<{
    manufacturingOrderId: string | null;
    values: Record<string, string>;
  }>({ manufacturingOrderId: null, values: {} });
  const outputQuery = useQuery<OutputAllocationData>({
    queryKey: ["manufacturing-output-allocation", manufacturingOrderId],
    queryFn: () =>
      apiJson<OutputAllocationData>(
        `/api/manufacturing-orders/${manufacturingOrderId}/output-allocation`,
        { fallbackError: "Failed to load output allocation." }
      ),
  });
  const data = outputQuery.data ?? null;
  const defaultDraft = useMemo(
    () =>
      Object.fromEntries(
        data?.productionDestinations.map((destination) => [
          destination.ingredientId,
          formatQuantity(destination.assignedQty),
        ]) ?? []
      ),
    [data]
  );
  const draft =
    draftState.manufacturingOrderId === manufacturingOrderId
      ? draftState.values
      : defaultDraft;
  const assignedProduction = Object.values(draft).reduce(
    (sum, value) => sum + readQuantity(value),
    0
  );
  const outputFree = data
    ? Math.max(
        0,
        readQuantity(data.sourceMo.plannedQuantity) -
          readQuantity(data.assignedSalesQty) -
          assignedProduction
      )
    : 0;

  const mutation = useMutation({
    mutationFn: () =>
      apiJson<OutputAllocationData>(
        `/api/manufacturing-orders/${manufacturingOrderId}/output-allocation`,
        {
          method: "PUT",
          body: {
            productionAllocations: Object.entries(draft)
              .map(([ingredientId, quantity]) => ({ ingredientId, quantity }))
              .filter((allocation) => readQuantity(allocation.quantity) > 0),
          },
          fallbackError: "Failed to save output allocation.",
        }
      ),
    onSuccess: async (nextData) => {
      setDraftState({
        manufacturingOrderId,
        values: Object.fromEntries(
          nextData.productionDestinations.map((destination) => [
            destination.ingredientId,
            formatQuantity(destination.assignedQty),
          ])
        ),
      });
      setCarriedQty(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["manufacturing-output-allocation", manufacturingOrderId],
        }),
        queryClient.invalidateQueries({ queryKey: ["sales-line-allocation"] }),
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      ]);
    },
  });

  const canSave =
    !!data &&
    !outputQuery.isLoading &&
    !mutation.isPending &&
    JSON.stringify(draft) !== JSON.stringify(defaultDraft);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (carriedQty == null) return;
      if (event.key === "Escape") {
        setCarriedQty(null);
      } else if (event.key.toLowerCase() === "h") {
        setCarriedQty((current) =>
          current == null ? null : Math.max(1, Math.floor(current / 2))
        );
      } else if (event.key === "+" || event.key === "=") {
        setCarriedQty((current) =>
          current == null ? null : clampQuantity(current + (event.shiftKey ? 5 : 1), outputFree)
        );
      } else if (event.key === "-") {
        setCarriedQty((current) =>
          current == null ? null : Math.max(1, current - (event.shiftKey ? 5 : 1))
        );
      } else {
        return;
      }
      event.preventDefault();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [carriedQty, outputFree]);

  function updateDestination(ingredientId: string, quantity: number) {
    setDraftState((current) => ({
      manufacturingOrderId,
      values: {
        ...(current.manufacturingOrderId === manufacturingOrderId
          ? current.values
          : defaultDraft),
        [ingredientId]: toQuantityString(quantity),
      },
    }));
  }

  function placeOnDestination(ingredientId: string) {
    if (carriedQty == null || !data) return;
    const destination = data.productionDestinations.find(
      (candidate) => candidate.ingredientId === ingredientId
    );
    if (!destination) return;
    const current = readQuantity(draft[ingredientId]);
    const remaining = Math.max(0, readQuantity(destination.remainingNeed) - current);
    const quantity = Math.min(carriedQty, remaining, outputFree);
    if (quantity <= 0) return;
    updateDestination(ingredientId, current + quantity);
    setCarriedQty((currentCarry) =>
      currentCarry == null || currentCarry <= quantity
        ? null
        : readQuantity(toQuantityString(currentCarry - quantity))
    );
    setSelectedIngredientId(ingredientId);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          Back
        </Button>
        <Button type="button" onClick={() => mutation.mutate()} disabled={!canSave}>
          {mutation.isPending ? "Saving..." : "Save allocation"}
        </Button>
      </div>

      {outputQuery.isLoading ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="text-foreground" />
        </div>
      ) : outputQuery.isError ? (
        <p className="text-sm text-destructive">{outputQuery.error.message}</p>
      ) : data ? (
        <>
          <div className="grid min-h-0 gap-4 xl:grid-cols-2">
            <WorkspacePanel
              title="Supply · Output"
              count={data.sourceMo.orderNumber}
              accent="supply"
            >
              <div className="rounded-md border bg-background p-3 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <HugeiconsIcon icon={Factory01Icon} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">{data.sourceMo.productName}</div>
                  <div className="text-sm text-muted-foreground">
                    {statusLabel(data.sourceMo.status)}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Planned</span>
                  <span className="font-medium">{formatQuantity(data.sourceMo.plannedQuantity)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Sales</span>
                  <span className="font-medium">{formatQuantity(data.assignedSalesQty)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Production</span>
                  <span className="font-medium">{formatQuantity(toQuantityString(assignedProduction))}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Unassigned</span>
                  <span className="font-medium">{formatQuantity(toQuantityString(outputFree))}</span>
                </div>
              </div>
              <Button
                type="button"
                className="mt-4 w-full"
                variant={carriedQty != null ? "secondary" : "outline"}
                onClick={() => setCarriedQty(outputFree > 0 ? outputFree : null)}
                disabled={outputFree <= 0}
              >
                Pick up output
              </Button>
              </div>
            </WorkspacePanel>

            <WorkspacePanel
              title="Demand · Orders"
              count={`${data.productionDestinations.length} MO`}
              accent="production"
            >
            {data.productionDestinations.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No production orders currently need this output.
              </div>
            ) : (
              data.productionDestinations.map((destination) => {
                const allocated = readQuantity(draft[destination.ingredientId]);
                const remaining = readQuantity(destination.remainingNeed);
                const shortQty = Math.max(0, remaining - allocated);
                const selected = selectedIngredientId === destination.ingredientId;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={destination.ingredientId}
                    aria-label={`Allocate output to ${destination.orderNumber}`}
                    onClick={() => placeOnDestination(destination.ingredientId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        placeOnDestination(destination.ingredientId);
                      }
                    }}
                    className={cn(
                      "cursor-pointer",
                      "w-full rounded-md border bg-background p-3 text-left shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "border-primary/30 bg-primary/5",
                      selected && "ring-2 ring-primary/25"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <Badge variant="secondary">MO</Badge>
                          <span>{destination.orderNumber}</span>
                          <span className="truncate text-muted-foreground">
                            produces {formatQuantity(destination.outputPlannedQuantity ?? "")}{" "}
                            {destination.outputProductName ?? destination.productName}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Input: {data.sourceMo.productName}
                          {destination.salesOrderNumber
                            ? ` · for ${destination.salesOrderNumber} ${destination.salesCustomerName ?? ""}`
                            : ""}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>{destination.plannedDate ? formatDate(destination.plannedDate) : "\u2014"}</div>
                        <div>{statusLabel(destination.status)}</div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-7 px-2 text-primary"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenOutput(destination.manufacturingOrderId);
                          }}
                        >
                          Open output
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <ProgressBar value={allocated} max={remaining} tone="primary" />
                      <div className="flex justify-end gap-4 text-sm">
                        <span>
                          <span className="text-muted-foreground">Allocated </span>
                          <span className="font-medium text-success">{formatQuantity(toQuantityString(allocated))}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Short </span>
                          <span className={cn("font-medium", shortQty > 0 && "text-destructive")}>
                            {shortLabel(shortQty)}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {mutation.error ? (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            ) : null}
            </WorkspacePanel>
          </div>
          <CarryPanel
            carried={
              carriedQty == null
                ? null
                : {
                    sourceKey: "output",
                    sourceType: "manufacturing_order",
                    sourceId: manufacturingOrderId,
                    sourceLabel: data.sourceMo.orderNumber,
                    sourceIndex: 0,
                    quantity: carriedQty,
                  }
            }
            onClear={() => setCarriedQty(null)}
            className="bottom-6"
          />
        </>
      ) : null}
    </div>
  );
}

export function AllocationSheet({
  lineId,
  open,
  onOpenChange,
  outputManufacturingOrderId,
  onOutputManufacturingOrderChange,
}: Props) {
  const queryClient = useQueryClient();
  const [internalOutputMoId, setInternalOutputMoId] = useState<string | null>(null);
  const isOutputMoControlled = outputManufacturingOrderId !== undefined;
  const outputMoId = isOutputMoControlled
    ? outputManufacturingOrderId
    : internalOutputMoId;
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [carried, setCarried] = useState<CarryState>(null);
  const [draftState, setDraftState] = useState<AllocationDraftState>({
    lineId: null,
    values: {},
  });
  const query = useQuery<SalesAllocationSheetData>({
    queryKey: ["sales-line-allocation", lineId],
    queryFn: () =>
      apiJson<SalesAllocationSheetData>(
        `/api/sales-order-lines/${lineId}/allocation`,
        { fallbackError: "Failed to load allocation." }
      ),
    enabled: open && lineId != null && outputMoId == null,
  });

  const data = query.data ?? null;
  const defaultDraftsByLine = useMemo(
    () =>
      Object.fromEntries(
        data?.demandRows.map((row) => [
          row.salesOrderLineId,
          Object.fromEntries(
            row.sources.map((source) => [
              allocationKey(source.sourceType, source.sourceId),
              source.quantity,
            ])
          ),
        ]) ?? []
      ),
    [data]
  );
  const draftsByLine =
    draftState.lineId === lineId ? draftState.values : defaultDraftsByLine;
  const sourceMetaByKey = useMemo(
    () =>
      new Map(
        data?.supplySources.map((source, index) => [
          allocationKey(source.sourceType, source.sourceId),
          { source, index },
        ]) ?? []
      ),
    [data]
  );
  const targetLine = data?.targetLine ?? null;
  const targetLineId = targetLine?.salesOrderLineId ?? null;

  function setOutputMoId(id: string | null) {
    if (isOutputMoControlled) {
      onOutputManufacturingOrderChange?.(id);
      return;
    }
    setInternalOutputMoId(id);
  }

  function openOutputMo(id: string) {
    setCarried(null);
    setOutputMoId(id);
  }

  function updateDrafts(nextDrafts: Record<string, AllocationDraft>) {
    setDraftState({ lineId, values: nextDrafts });
  }

  function getLineDraftTotal(salesOrderLineId: string) {
    return Object.values(draftsByLine[salesOrderLineId] ?? {}).reduce(
      (sum, value) => sum + readQuantity(value),
      0
    );
  }

  function getSourceDraftTotal(sourceKeyValue: string) {
    return Object.values(draftsByLine).reduce(
      (sum, lineDraft) => sum + readQuantity(lineDraft[sourceKeyValue]),
      0
    );
  }

  function getSourcePreviewFree(source: SalesAllocationSource) {
    return Math.max(
      0,
      readQuantity(source.totalQty) -
        getSourceDraftTotal(allocationKey(source.sourceType, source.sourceId))
    );
  }

  function getSourcePreviewFreeByKey(sourceKeyValue: string) {
    const source = data?.supplySources.find(
      (candidate) => allocationKey(candidate.sourceType, candidate.sourceId) === sourceKeyValue
    );
    if (!source) return 0;
    return getSourcePreviewFree(source);
  }

  function pickToken(token: AllocationTokenData) {
    setCarried(token);
    setSelectedSourceKey(token.sourceKey);
  }

  function allocateTokenToLine(token: AllocationTokenData, salesOrderLineId: string) {
    const row = data?.demandRows.find(
      (demandRow) => demandRow.salesOrderLineId === salesOrderLineId
    );
    if (!row) return;

    const lineDraft = draftsByLine[salesOrderLineId] ?? {};
    const currentQty = readQuantity(lineDraft[token.sourceKey]);
    const lineShortQty = Math.max(
      0,
      readQuantity(row.remainingQty) - getLineDraftTotal(salesOrderLineId)
    );
    const sourceFree = Math.max(0, getSourcePreviewFreeByKey(token.sourceKey));
    const quantity = Math.min(token.quantity, lineShortQty, sourceFree);
    if (quantity <= 0) return;

    updateDrafts({
      ...draftsByLine,
      [salesOrderLineId]: {
        ...lineDraft,
        [token.sourceKey]: toQuantityString(currentQty + quantity),
      },
    });
    setCarried(
      token.quantity <= quantity
        ? null
        : { ...token, quantity: readQuantity(toQuantityString(token.quantity - quantity)) }
    );
  }

  function moveAllocatedTokenToLine(
    token: AllocationTokenData,
    targetSalesOrderLineId: string
  ) {
    const originLineId = token.originLineId;
    if (!originLineId || originLineId === targetSalesOrderLineId) return;

    const targetRow = data?.demandRows.find(
      (demandRow) => demandRow.salesOrderLineId === targetSalesOrderLineId
    );
    if (!targetRow) return;

    const originDraft = draftsByLine[originLineId] ?? {};
    const targetDraft = draftsByLine[targetSalesOrderLineId] ?? {};
    const originQty = readQuantity(originDraft[token.sourceKey]);
    const targetCurrentQty = readQuantity(targetDraft[token.sourceKey]);
    const targetShortQty = Math.max(
      0,
      readQuantity(targetRow.remainingQty) - getLineDraftTotal(targetSalesOrderLineId)
    );
    const quantity = Math.min(token.quantity, originQty, targetShortQty);
    if (quantity <= 0) return;

    updateDrafts({
      ...draftsByLine,
      [originLineId]: {
        ...originDraft,
        [token.sourceKey]: toQuantityString(originQty - quantity),
      },
      [targetSalesOrderLineId]: {
        ...targetDraft,
        [token.sourceKey]: toQuantityString(targetCurrentQty + quantity),
      },
    });
    setCarried(
      token.quantity <= quantity
        ? null
        : { ...token, quantity: readQuantity(toQuantityString(token.quantity - quantity)) }
    );
  }

  function placeOnLine(salesOrderLineId: string) {
    if (!carried) return;
    if (carried.originLineId) {
      moveAllocatedTokenToLine(carried, salesOrderLineId);
      return;
    }
    allocateTokenToLine(carried, salesOrderLineId);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!carried) return;
      if (event.key === "Escape") {
        setCarried(null);
      } else if (event.key.toLowerCase() === "a") {
        setCarried((current) =>
          current
            ? { ...current, quantity: getSourcePreviewFreeByKey(current.sourceKey) }
            : null
        );
      } else if (event.key.toLowerCase() === "h") {
        setCarried((current) =>
          current ? { ...current, quantity: Math.max(1, Math.floor(current.quantity / 2)) } : null
        );
      } else if (event.key === "+" || event.key === "=") {
        setCarried((current) =>
          current
            ? {
                ...current,
                quantity: clampQuantity(
                  current.quantity + (event.shiftKey ? 5 : 1),
                  Math.max(current.quantity, getSourcePreviewFreeByKey(current.sourceKey))
                ),
              }
            : null
        );
      } else if (event.key === "-") {
        setCarried((current) =>
          current
            ? { ...current, quantity: Math.max(1, current.quantity - (event.shiftKey ? 5 : 1)) }
            : null
        );
      } else if (event.key === "Enter" && targetLineId) {
        placeOnLine(targetLineId);
      } else {
        return;
      }
      event.preventDefault();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const totalOverRemaining = (data?.demandRows ?? []).some(
    (row) => getLineDraftTotal(row.salesOrderLineId) > readQuantity(row.remainingQty)
  );
  const overAllocatedSource = data?.supplySources.find((source) => {
    const key = allocationKey(source.sourceType, source.sourceId);
    return getSourceDraftTotal(key) > readQuantity(source.totalQty);
  });
  const targetDraftTotal = targetLineId ? getLineDraftTotal(targetLineId) : 0;
  const targetDraftShortQty = Math.max(
    0,
    readQuantity(targetLine?.remainingQty) - targetDraftTotal
  );
  const hasChanges =
    JSON.stringify(draftsByLine) !== JSON.stringify(defaultDraftsByLine);

  const mutation = useMutation({
    mutationFn: async () => {
      const changedLineIds = Object.keys(draftsByLine).filter(
        (salesOrderLineId) =>
          JSON.stringify(draftsByLine[salesOrderLineId] ?? {}) !==
          JSON.stringify(defaultDraftsByLine[salesOrderLineId] ?? {})
      );
      const sortedLineIds = changedLineIds.toSorted((left, right) => {
        const leftDelta =
          getLineDraftTotal(left) -
          Object.values(defaultDraftsByLine[left] ?? {}).reduce(
            (sum, value) => sum + readQuantity(value),
            0
          );
        const rightDelta =
          getLineDraftTotal(right) -
          Object.values(defaultDraftsByLine[right] ?? {}).reduce(
            (sum, value) => sum + readQuantity(value),
            0
          );
        return leftDelta - rightDelta;
      });

      for (const salesOrderLineId of sortedLineIds) {
        const lineDraft = draftsByLine[salesOrderLineId] ?? {};
        await apiJson<SalesAllocationSheetData>(
          `/api/sales-order-lines/${salesOrderLineId}/allocation`,
          {
            method: "PUT",
            body: {
              allocations: Object.entries(lineDraft).flatMap(([key, value]) => {
                const quantity = readQuantity(value);
                if (quantity <= 0) return [];
                return [
                  { ...parseAllocationKey(key), quantity: toQuantityString(quantity) },
                ];
              }),
            },
            fallbackError: "Failed to save allocation.",
          }
        );
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-detail"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-line-allocation"] }),
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      ]);
      setDraftState({ lineId: null, values: {} });
      setCarried(null);
    },
  });

  const canSave =
    hasChanges &&
    !mutation.isPending &&
    !query.isLoading &&
    !!data &&
    !totalOverRemaining &&
    !overAllocatedSource;

  const onHandSources = (data?.supplySources ?? []).filter(
    (source) => source.sourceType === "stock_pool" || source.sourceType === "lot"
  );
  const manufacturingSources = (data?.supplySources ?? []).filter(
    (source) => source.sourceType === "manufacturing_order"
  );
  const selectedSource =
    (selectedSourceKey ? sourceMetaByKey.get(selectedSourceKey)?.source : null) ??
    data?.supplySources[0] ??
    null;

  const sourceDestinations = selectedSource
    ? data?.demandRows.flatMap((row) => {
        const key = allocationKey(selectedSource.sourceType, selectedSource.sourceId);
        const quantity = readQuantity(draftsByLine[row.salesOrderLineId]?.[key]);
        if (quantity <= 0) return [];
        return [{ label: row.orderNumber, quantity, kind: "sales" as const }];
      }) ?? []
    : [];

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setOutputMoId(null);
          setCarried(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent className="relative overflow-hidden bg-background text-foreground data-[side=right]:w-full data-[side=right]:sm:w-[min(96vw,92rem)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b">
          <SheetTitle>Allocation Manager</SheetTitle>
          <SheetDescription className="sr-only">
            Allocate available stock and production to demand.
          </SheetDescription>
          {targetLine ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <HugeiconsIcon icon={PackageIcon} strokeWidth={2} className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-foreground">
                    {targetLine.itemName}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {targetLine.orderNumber} · {targetLine.customerName}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="secondary">{targetLine.unitName}</Badge>
                <Badge variant="outline">{statusLabel(targetLine.orderStatus)}</Badge>
              </div>
            </div>
          ) : null}
        </SheetHeader>

        {outputMoId ? (
          <OutputAllocationWorkspace
            manufacturingOrderId={outputMoId}
            onBack={() => {
              if (lineId == null) {
                onOpenChange(false);
                return;
              }
              setOutputMoId(null);
            }}
            onOpenOutput={openOutputMo}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            {lineId == null ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm font-medium">Choose a sales line or MO output first.</p>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            ) : query.isLoading ? (
              <div className="flex min-h-48 items-center justify-center">
                <Spinner className="text-foreground" />
              </div>
            ) : query.isError ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm text-destructive">{query.error.message}</p>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            ) : data && targetLine ? (
              <div className="grid min-h-0 gap-4 xl:grid-cols-2">
                <WorkspacePanel
                  title="Supply · Storage"
                  count={`${onHandSources.length} on hand · ${manufacturingSources.length} inbound`}
                  accent="supply"
                >
                  <div className="flex min-h-0 flex-col gap-4">
                    <div className="space-y-3">
                      <SectionTitle title="On hand" count={`${onHandSources.length} sources`} />
                      <div className="flex flex-wrap gap-2">
                        {onHandSources.map((source, sourceIndex) => {
                          const key = allocationKey(source.sourceType, source.sourceId);
                          return (
                            <SupplyStack
                              key={key}
                              source={source}
                              sourceKeyValue={key}
                              sourceIndex={sourceIndex}
                              previewFree={getSourcePreviewFree(source)}
                              isSelected={selectedSourceKey === key}
                              onPick={pickToken}
                              onOpenOutput={openOutputMo}
                            />
                          );
                        })}
                      </div>
                    </div>

                    <div className="border-t pt-3">
                      <SectionTitle
                        title="Inbound from MFG"
                        count={`${manufacturingSources.length} MOs`}
                        icon={
                          <HugeiconsIcon
                            icon={ArrowDown01Icon}
                            strokeWidth={2}
                            className="size-3.5 text-primary"
                          />
                        }
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        {manufacturingSources.map((source, index) => {
                          const key = allocationKey(source.sourceType, source.sourceId);
                          return (
                            <SupplyStack
                              key={key}
                              source={source}
                              sourceKeyValue={key}
                              sourceIndex={onHandSources.length + index}
                              previewFree={getSourcePreviewFree(source)}
                              isSelected={selectedSourceKey === key}
                              onPick={pickToken}
                              onOpenOutput={openOutputMo}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {targetLine && targetDraftShortQty > 0 ? (
                    <CreateManufacturingOrdersDialog
                      salesOrderId={targetLine.salesOrderId}
                      salesOrderLabel={`${targetLine.orderNumber} - ${targetLine.customerName}`}
                      buttonLabel="Add MO"
                      buttonVariant="outline"
                      buttonSize="lg"
                      buttonClassName="h-20 w-full flex-col border-dashed bg-card text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground [&_svg]:size-5"
                      initialPlannedDate={todayDateString()}
                      openManufacturingOrders={data.supplySources
                        .filter(
                          (source) =>
                            source.sourceType === "manufacturing_order" &&
                            source.sourceId != null &&
                            (source.status === "draft" || source.status === "released")
                        )
                        .map((source) => ({
                          id: source.sourceId ?? source.label,
                          orderNumber: source.label,
                          itemName: targetLine.itemName,
                          quantity: `${formatQuantity(source.totalQty)} ${targetLine.unitName}`,
                          plannedDate: source.date,
                          priorityRank: source.priorityRank,
                          status: statusLabel(source.status),
                        }))}
                      initialLineQuantities={[
                        {
                          salesOrderLineId: targetLine.salesOrderLineId,
                          quantity: toQuantityString(targetDraftShortQty),
                        },
                      ]}
                    />
                  ) : null}

                  <SourceDetailPanel
                    source={selectedSource}
                    destinations={sourceDestinations}
                  />
                </WorkspacePanel>

                <WorkspacePanel
                  title="Demand · Orders"
                  count={`${data.demandRows.length} SO · shipping date`}
                  accent="default"
                >
                  <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
                    {data.demandRows
                      .toSorted((a, b) => Number(b.isTarget) - Number(a.isTarget))
                      .map((row) => {
                        const isTarget = row.salesOrderLineId === targetLine.salesOrderLineId;
                        const allocatedQty = getLineDraftTotal(row.salesOrderLineId);
                        const shortQty = Math.max(
                          0,
                          readQuantity(row.remainingQty) - allocatedQty
                        );

                        return (
                          <DemandCard
                            key={row.salesOrderLineId}
                            row={row}
                            isTarget={isTarget}
                            allocatedQty={allocatedQty}
                            shortQty={shortQty}
                            carried={carried}
                            onPlace={() => placeOnLine(row.salesOrderLineId)}
                          >
                            {Object.entries(draftsByLine[row.salesOrderLineId] ?? {}).flatMap(
                              ([key, value]) => {
                                const quantity = readQuantity(value);
                                if (quantity <= 0) return [];
                                const meta = sourceMetaByKey.get(key);
                                const parsed = parseAllocationKey(key);
                                return (
                                  <AllocationChip
                                    key={key}
                                    label={meta?.source.label ?? "Source"}
                                    quantity={quantity}
                                    onPick={() =>
                                      pickToken({
                                        sourceKey: key,
                                        sourceType: parsed.sourceType,
                                        sourceId: parsed.sourceId,
                                        sourceLabel: meta?.source.label ?? "Source",
                                        sourceIndex: meta?.index ?? 0,
                                        quantity,
                                        originLineId: row.salesOrderLineId,
                                      })
                                    }
                                  />
                                );
                              }
                            )}
                          </DemandCard>
                        );
                      })}
                  </div>
                </WorkspacePanel>
              </div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm font-medium">No allocatable line found.</p>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            )}
            <CarryPanel
              carried={carried}
              onClear={() => setCarried(null)}
              className="bottom-20"
            />
          </div>
        )}

        {!outputMoId ? (
          <SheetFooter className="border-t">
            {mutation.error ? (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            ) : totalOverRemaining && targetLine ? (
              <p className="text-sm text-destructive">
                Allocated quantity cannot exceed {formatQuantity(targetLine.remainingQty)}{" "}
                {targetLine.unitName}.
              </p>
            ) : overAllocatedSource ? (
              <p className="text-sm text-destructive">
                {overAllocatedSource.label} only has{" "}
                {formatQuantity(overAllocatedSource.totalQty)} total.
              </p>
            ) : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraftState({ lineId, values: defaultDraftsByLine });
                  setCarried(null);
                }}
                disabled={!hasChanges || mutation.isPending}
              >
                <HugeiconsIcon icon={ReloadIcon} strokeWidth={2} />
                Reset
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => mutation.mutate()}
                  disabled={!canSave}
                >
                  {mutation.isPending ? "Saving..." : "Save allocation"}
                </Button>
              </div>
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
