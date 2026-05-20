"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatQuantity, normalizeNumeric } from "@/lib/format";
import type { AllocationWorkspace } from "@/lib/inventory/allocation/types";

export type IngredientLotAllocationValue = {
  itemId: string;
  allocations: Array<{ sourceId: string; quantity: string }>;
};

type ManufacturingIngredientSources = AllocationWorkspace & {
  currentAllocations?: Array<{ sourceId: string; quantity: string }>;
};

function parseQuantityValue(value: string | number | null | undefined) {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQuantityNumber(value: number) {
  return Number(normalizeNumeric(value));
}

function sumLotAllocations(
  allocations: IngredientLotAllocationValue["allocations"] | undefined,
) {
  return (allocations ?? []).reduce(
    (sum, allocation) => sum + parseQuantityValue(allocation.quantity),
    0,
  );
}

function normalizeAllocationQuantity(value: string) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Inline lot picker for one manufacturing-order ingredient. Lifted from the
 * legacy MO create/edit form so the redesigned MO sheet can reuse it for the
 * CUSTOM lot strategy. Same data flow as the legacy callsite:
 *   - fetches `/api/manufacturing-orders/ingredient-sources?itemId=…`
 *   - emits `{ sourceId, quantity }[]` via onChange
 *   - the parent persists allocations into form.lotAllocations[]
 */
export function ManufacturingIngredientLotCard({
  itemId,
  ingredientId,
  itemName,
  unitName,
  plannedQuantity,
  value,
  manufacturingOrderId,
  autoAllocateOnSave,
  onChange,
}: {
  itemId: string;
  ingredientId: string | null;
  itemName: string;
  unitName: string;
  plannedQuantity: string;
  value: IngredientLotAllocationValue | undefined;
  manufacturingOrderId?: string | null;
  autoAllocateOnSave: boolean;
  onChange: (
    allocations: IngredientLotAllocationValue["allocations"],
  ) => void;
}) {
  const plannedQuantityNumber = parseQuantityValue(plannedQuantity);
  const sourcesQuery = useQuery<ManufacturingIngredientSources>({
    queryKey: ["manufacturing-ingredient-sources", itemId, ingredientId],
    queryFn: async () => {
      const params = new URLSearchParams({ itemId });
      if (ingredientId) params.set("ingredientId", ingredientId);
      if (manufacturingOrderId) {
        params.set("manufacturingOrderId", manufacturingOrderId);
      }
      const response = await fetch(
        `/api/manufacturing-orders/ingredient-sources?${params}`,
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to load ingredient lots.");
      }

      return body as ManufacturingIngredientSources;
    },
    enabled: itemId.length > 0 && plannedQuantityNumber > 0,
  });
  const lots = (sourcesQuery.data?.sources ?? []).filter(
    (source) => source.sourceType === "inventory_lot",
  );
  const currentBySourceId = new Map(
    (sourcesQuery.data?.currentAllocations ?? []).map((allocation) => [
      allocation.sourceId,
      parseQuantityValue(allocation.quantity),
    ]),
  );
  const effectiveAllocations = value?.allocations ?? sourcesQuery.data?.currentAllocations ?? [];
  const allocationBySourceId = new Map(
    effectiveAllocations.map((allocation) => [
      allocation.sourceId,
      allocation.quantity,
    ]),
  );
  const manualAllocatedQuantity = sumLotAllocations(effectiveAllocations);
  const allocationPreview = (() => {
    const manualBySourceId = new Map(
      effectiveAllocations.map((allocation) => [
        allocation.sourceId,
        parseQuantityValue(allocation.quantity),
      ]),
    );
    let remaining = Math.max(0, plannedQuantityNumber - manualAllocatedQuantity);
    let fifoQuantity = 0;

    if (autoAllocateOnSave && remaining > 0) {
      for (const source of lots) {
        if (remaining <= 0) break;
        const maxQuantity =
          parseQuantityValue(source.maxQtyForPrimaryDemand) +
          (currentBySourceId.get(source.sourceId) ?? 0);
        const manualQuantity = manualBySourceId.get(source.sourceId) ?? 0;
        const availableQuantity = Math.max(0, maxQuantity - manualQuantity);
        const quantity = Math.min(remaining, availableQuantity);
        if (quantity <= 0) continue;
        fifoQuantity += quantity;
        remaining = Math.max(0, remaining - quantity);
      }
    }

    return {
      fifoQuantity: normalizeQuantityNumber(fifoQuantity),
      totalAllocatedQuantity: normalizeQuantityNumber(
        manualAllocatedQuantity + fifoQuantity,
      ),
      openQuantity: normalizeQuantityNumber(remaining),
    };
  })();
  const isOverPlanned = manualAllocatedQuantity > plannedQuantityNumber + 0.0001;

  const setSourceQuantity = (sourceId: string, quantity: string) => {
    const normalized = normalizeAllocationQuantity(quantity);
    if (normalized == null) return;
    const nextBySourceId = new Map(allocationBySourceId);

    if (normalized) {
      nextBySourceId.set(sourceId, normalized);
    } else {
      nextBySourceId.delete(sourceId);
    }

    onChange(
      [...nextBySourceId.entries()].map(([nextSourceId, nextQuantity]) => ({
        sourceId: nextSourceId,
        quantity: nextQuantity,
      })),
    );
  };

  const autoFillFifo = () => {
    let remaining = plannedQuantityNumber;
    const next: IngredientLotAllocationValue["allocations"] = [];

    for (const source of lots) {
      if (remaining <= 0) break;
      const maxQuantity =
        parseQuantityValue(source.maxQtyForPrimaryDemand) +
        (currentBySourceId.get(source.sourceId) ?? 0);
      const quantity = Math.min(remaining, maxQuantity);
      if (quantity <= 0) continue;

      next.push({ sourceId: source.sourceId, quantity: normalizeNumeric(quantity) });
      remaining = Math.max(0, remaining - quantity);
    }

    onChange(next);
  };

  if (plannedQuantityNumber <= 0) return null;

  return (
    <div className="border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{itemName}</div>
          <div className="text-[length:var(--text-xs)] text-muted-foreground">
            Need {formatQuantity(plannedQuantity)} {unitName}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-[length:var(--text-xs)] text-muted-foreground">
            <div>
              {formatQuantity(normalizeNumeric(allocationPreview.totalAllocatedQuantity))}{" "}
              {autoAllocateOnSave ? "will hold" : "allocated"}
            </div>
            {autoAllocateOnSave && allocationPreview.fifoQuantity > 0 ? (
              <div>
                {formatQuantity(normalizeNumeric(allocationPreview.fifoQuantity))} FIFO on save
              </div>
            ) : null}
            <div>{formatQuantity(normalizeNumeric(allocationPreview.openQuantity))} open</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={autoFillFifo}
            disabled={sourcesQuery.isLoading || lots.length === 0}
          >
            Auto FIFO
          </Button>
        </div>
      </div>

      {sourcesQuery.isLoading ? (
        <div className="px-4 py-4 text-sm text-muted-foreground">Loading lots...</div>
      ) : sourcesQuery.isError ? (
        <div className="px-4 py-4 text-sm text-destructive">
          Failed to load ingredient lots.
        </div>
      ) : lots.length === 0 ? (
        <div className="px-4 py-4 text-sm text-muted-foreground">
          No available lots found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lot</TableHead>
                <TableHead className="w-28 text-right">Free</TableHead>
                <TableHead className="w-32 text-right">Allocate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((source) => {
                const currentQuantity = currentBySourceId.get(source.sourceId) ?? 0;
                const maxQuantity =
                  parseQuantityValue(source.maxQtyForPrimaryDemand) + currentQuantity;
                const sourceValue = allocationBySourceId.get(source.sourceId) ?? "";
                const sourceQuantity = Number(sourceValue);
                const sourceInvalid =
                  sourceValue.trim() !== "" &&
                  (!Number.isFinite(sourceQuantity) || sourceQuantity <= 0);
                const sourceOver =
                  Number.isFinite(sourceQuantity) && sourceQuantity > maxQuantity + 0.0001;
                return (
                  <TableRow key={source.sourceKey}>
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="font-medium">{source.label}</div>
                        {source.contextLabel ? (
                          <div className="text-[length:var(--text-xs)] text-muted-foreground">
                            {source.contextLabel}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {formatQuantity(normalizeNumeric(maxQuantity))}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={sourceValue}
                        onChange={(event) =>
                          setSourceQuantity(source.sourceId, event.target.value)
                        }
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        aria-invalid={sourceInvalid || sourceOver}
                        className="ml-auto w-24 text-right"
                      />
                      {sourceOver ? (
                        <div className="mt-1 text-right text-[length:var(--text-2xs)] text-destructive">
                          {formatQuantity(normalizeNumeric(sourceQuantity - maxQuantity))} over
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {isOverPlanned ? (
            <div className="border-t px-4 py-2 text-[length:var(--text-xs)] text-destructive">
              {formatQuantity(normalizeNumeric(manualAllocatedQuantity - plannedQuantityNumber))} over need
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
