"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailPageActions } from "@/components/detail-page-actions";
import { Input } from "@/components/ui/input";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import {
  SortableDragHandle,
  SortableReorder,
  useSortableReorderItem,
} from "@/components/sortable-reorder";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipHeader } from "@/components/tooltip-header";
import { formatDate, formatDateTime, formatPrice, formatQuantity } from "@/lib/format";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import {
  formatMinimumLotAgeRequirement,
  getMinimumLotAgeDays,
} from "@/lib/bom/constraints";
import {
  BATCH_YIELD_TOOLTIP,
  BOM_QTY_PER_BATCH_TOOLTIP,
  BOM_QTY_PER_UNIT_TOOLTIP,
  COST_PER_UNIT_TOOLTIP,
  MANUFACTURING_ACTUAL_QTY_TOOLTIP,
  MANUFACTURING_COMPONENT_COST_TOOLTIP,
  MANUFACTURING_EXECUTION_TOOLTIP,
  MANUFACTURING_PICKED_QTY_TOOLTIP,
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  MANUFACTURING_REMAINING_QTY_TOOLTIP,
  MANUFACTURING_SALES_ORDER_TOOLTIP,
  MATERIAL_COST_TOOLTIP,
  LEDGER_LOT_TOOLTIP,
} from "@/lib/tooltip-copy";
import { MoStageAction } from "./mo-stage-action";
import { ManufacturingPickProgressBadge } from "./pick-progress-badge";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import type { ManufacturingOrderDetail as ManufacturingOrderDetailType } from "./types";

type ManufacturingIngredient =
  ManufacturingOrderDetailType["ingredients"][number];

type OutputAllocationData = {
  sourceMo: {
    id: string;
    plannedQuantity: string;
    actualQuantity: string;
  };
  productionDestinations: Array<{
    ingredientId: string;
    orderNumber: string;
    productName: string;
    remainingNeed: string;
    assignedQty: string;
    shortQty: string;
  }>;
  assignedSalesQty: string;
  assignedProductionQty: string;
  unassignedQty: string;
};

function moveIngredient(
  ingredients: ManufacturingIngredient[],
  fromIndex: number,
  toIndex: number
) {
  const next = [...ingredients];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return ingredients;
  next.splice(toIndex, 0, moved);
  return next;
}

function hasSameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function PriorityRankEditor({
  order,
  onUpdated,
}: {
  order: ManufacturingOrderDetailType;
  onUpdated: () => Promise<void>;
}) {
  const [value, setValue] = useState(order.priorityRank?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const canEdit = order.status === "draft" || order.status === "released";

  const mutation = useMutation({
    mutationFn: async (priorityRank: number | null) => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priorityRank }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to update priority rank.");
      }
    },
    onSuccess: async () => {
      setError(null);
      await onUpdated();
    },
    onError: (updateError) => {
      setError(updateError.message);
    },
  });

  const commit = () => {
    const trimmed = value.trim();
    const nextRank = trimmed ? Number(trimmed) : null;

    if (
      trimmed &&
      (typeof nextRank !== "number" || !Number.isInteger(nextRank) || nextRank <= 0)
    ) {
      setError("Enter a positive whole number.");
      return;
    }

    if (
      nextRank === order.priorityRank ||
      (nextRank == null && order.priorityRank == null)
    ) {
      return;
    }

    mutation.mutate(nextRank);
  };

  if (!canEdit) {
    return <>{order.priorityRank == null ? "\u2014" : `#${order.priorityRank}`}</>;
  }

  return (
    <div className="max-w-24">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        disabled={mutation.isPending}
        inputMode="numeric"
        aria-label={`Priority rank for ${order.orderNumber}`}
        placeholder="None"
        className="h-8 px-2 font-mono text-sm"
      />
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function OutputAllocationSection({
  order,
  onUpdated,
}: {
  order: ManufacturingOrderDetailType;
  onUpdated: () => Promise<void>;
}) {
  const [data, setData] = useState<OutputAllocationData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAllocation = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/output-allocation`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to load output allocation.");
      }
      setData(body);
      setDraft(
        Object.fromEntries(
          body.productionDestinations.map(
            (destination: OutputAllocationData["productionDestinations"][number]) => [
              destination.ingredientId,
              formatQuantity(destination.assignedQty),
            ]
          )
        )
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load output allocation.");
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => {
    void loadAllocation();
  }, [loadAllocation]);

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/output-allocation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productionAllocations: Object.entries(draft)
            .map(([ingredientId, quantity]) => ({ ingredientId, quantity }))
            .filter((allocation) => Number(allocation.quantity) > 0),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to save output allocation.");
      }
      return body as OutputAllocationData;
    },
    onSuccess: async (nextData) => {
      setData(nextData);
      setDraft(
        Object.fromEntries(
          nextData.productionDestinations.map((destination) => [
            destination.ingredientId,
            formatQuantity(destination.assignedQty),
          ])
        )
      );
      setError(null);
      await onUpdated();
    },
    onError: (saveError) => {
      setError(saveError instanceof Error ? saveError.message : "Failed to save output allocation.");
    },
  });

  const canEdit = order.status !== "cancelled";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Output Allocation</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!canEdit || loading || mutation.isPending}
        >
          {mutation.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
      {data ? (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>Planned {formatQuantity(data.sourceMo.plannedQuantity)}</span>
            <span>Sales {formatQuantity(data.assignedSalesQty)}</span>
            <span>Production {formatQuantity(data.assignedProductionQty)}</span>
            <span>Unassigned {formatQuantity(data.unassignedQty)}</span>
          </div>
          {data.productionDestinations.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Production Orders</TableHead>
                    <TableHead className="text-right">Remaining Need</TableHead>
                    <TableHead className="w-36 text-right">Allocated</TableHead>
                    <TableHead className="text-right">Short</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.productionDestinations.map((destination) => (
                    <TableRow key={destination.ingredientId}>
                      <TableCell>
                        <div className="font-medium">{destination.orderNumber}</div>
                        <div className="text-sm text-muted-foreground">
                          {destination.productName}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(destination.remainingNeed)}
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={draft[destination.ingredientId] ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [destination.ingredientId]: event.target.value,
                            }))
                          }
                          disabled={!canEdit || mutation.isPending}
                          className="text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(destination.shortQty)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No production orders currently need this output.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading output allocation..." : "Output allocation is unavailable."}
        </p>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function IngredientTableRow({
  ingredient,
  canReorder,
}: {
  ingredient: ManufacturingIngredient;
  canReorder: boolean;
}) {
  const { attributes, listeners, setNodeRef, style } = useSortableReorderItem(
    ingredient.id
  );
  const minimumLotAgeDays = getMinimumLotAgeDays(ingredient.constraints);

  return (
    <TableRow ref={canReorder ? setNodeRef : undefined} style={style}>
      {canReorder && (
        <TableCell className="w-10">
          <SortableDragHandle
            attributes={attributes}
            listeners={listeners}
            label={`Reorder ${ingredient.itemName}`}
          />
        </TableCell>
      )}
      <TableCell>
        <Link
          href={itemDetailHref(ingredient.itemType, ingredient.itemId)}
          className="hover:underline"
        >
          {ingredient.itemSku
            ? `${ingredient.itemName} (${ingredient.itemSku})`
            : ingredient.itemName}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{ingredient.itemType}</Badge>
      </TableCell>
      <TableCell className="text-right">{ingredient.quantityPerUnit}</TableCell>
      <TableCell className="text-right">{ingredient.plannedQuantity}</TableCell>
      <TableCell className="text-right">{ingredient.pickedQuantity}</TableCell>
      <TableCell className="text-right">{ingredient.remainingQuantity}</TableCell>
      <TableCell className="text-right">
        {ingredient.actualQuantity != null ? ingredient.actualQuantity : "\u2014"}
      </TableCell>
      <TableCell className="text-right">
        {formatPrice(ingredient.actualCostTotal) ?? "\u2014"}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {minimumLotAgeDays
          ? formatMinimumLotAgeRequirement(minimumLotAgeDays)
          : "\u2014"}
      </TableCell>
    </TableRow>
  );
}

function IngredientsTable({
  order,
  onUpdated,
}: {
  order: ManufacturingOrderDetailType;
  onUpdated: () => Promise<void>;
}) {
  const initialIngredientIds = order.ingredients.map((ingredient) => ingredient.id);
  const [savedIngredientIds, setSavedIngredientIds] = useState(initialIngredientIds);
  const [ingredients, setIngredients] = useState(order.ingredients);
  const [error, setError] = useState<string | null>(null);
  const canReorder =
    order.status === "draft" ||
    (order.status === "released" && order.manufacturingMode !== "batch");
  const isDirty = !hasSameOrder(
    ingredients.map((ingredient) => ingredient.id),
    savedIngredientIds
  );

  const mutation = useMutation({
    mutationFn: async (ingredientIds: string[]) => {
      const response = await fetch(
        `/api/manufacturing-orders/${order.id}/ingredients/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientIds }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to save ingredient order.");
      }
    },
    onMutate: () => {
      setError(null);
    },
    onSuccess: async (_data, ingredientIds) => {
      setSavedIngredientIds(ingredientIds);
      await onUpdated();
    },
    onError: (saveError) => {
      setError(saveError.message);
    },
  });

  function handleMove(fromIndex: number, toIndex: number) {
    if (!canReorder || mutation.isPending) return;
    setIngredients((current) => moveIngredient(current, fromIndex, toIndex));
  }

  function saveOrder() {
    mutation.mutate(ingredients.map((ingredient) => ingredient.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Ingredients</h2>
        {canReorder && isDirty && (
          <Button
            type="button"
            size="sm"
            onClick={saveOrder}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving..." : "Save Order"}
          </Button>
        )}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {canReorder && <TableHead className="w-10" />}
              <TableHead>Ingredient</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">
                <TooltipHeader
                  label={order.manufacturingMode === "batch" ? "Qty / Batch" : "Qty / Unit"}
                  tooltip={
                    order.manufacturingMode === "batch"
                      ? BOM_QTY_PER_BATCH_TOOLTIP
                      : BOM_QTY_PER_UNIT_TOOLTIP
                  }
                />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Planned" tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Picked" tooltip={MANUFACTURING_PICKED_QTY_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Remaining" tooltip={MANUFACTURING_REMAINING_QTY_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Actual" tooltip={MANUFACTURING_ACTUAL_QTY_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Cost" tooltip={MANUFACTURING_COMPONENT_COST_TOOLTIP} />
              </TableHead>
              <TableHead>Requirements</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {canReorder ? (
              <SortableReorder
                ids={ingredients.map((ingredient) => ingredient.id)}
                onMove={handleMove}
              >
                {ingredients.map((ingredient) => (
                  <IngredientTableRow
                    key={ingredient.id}
                    ingredient={ingredient}
                    canReorder
                  />
                ))}
              </SortableReorder>
            ) : (
              ingredients.map((ingredient) => (
                <IngredientTableRow
                  key={ingredient.id}
                  ingredient={ingredient}
                  canReorder={false}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function ManufacturingOrderDetail({
  order,
  canViewLedger = false,
}: {
  order: ManufacturingOrderDetailType;
  canViewLedger?: boolean;
}) {
  const timeZone = useOrganizationTimeZone();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    router.refresh();
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await refreshQueries();
      setDeleteOpen(false);
      router.push("/manufacturing/orders");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/duplicate`, {
        method: "POST",
        headers: createIdempotencyHeaders("manufacturing-order-duplicate"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to duplicate order.");
      }
      return body as { id: string };
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (created) => {
      await refreshQueries();
      router.push(`/manufacturing/orders/${created.id}`);
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/cancel`, {
        method: "POST",
        headers: createIdempotencyHeaders("manufacturing-order-cancel"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await refreshQueries();
      setCancelOpen(false);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const canEdit = order.status === "draft";
  const canCancel = order.status === "draft" || order.status === "released";
  const canDelete = order.status !== "released";

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/manufacturing/orders"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to Orders
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
              <ManufacturingOrderStatusBadge status={order.status} />
              {order.status === "released" && (
                <ManufacturingPickProgressBadge status={order.pickProgressStatus} />
              )}
              {order.deletedAt && <Badge variant="outline">Deleted</Badge>}
            </div>
          </div>

          <DetailPageActions
            editHref={canEdit ? `/manufacturing/orders/${order.id}/edit` : undefined}
            menu={[
              ...(canViewLedger
                ? [
                    {
                      label: "View inventory activity",
                      onSelect: () =>
                        router.push(
                          buildInventoryLedgerHref({
                            documentType: "manufacturing_order",
                            documentId: order.id,
                          })
                        ),
                    },
                  ]
                : []),
              ...(order.deletedAt == null
                ? [
                    {
                      label: "Duplicate",
                      onSelect: () => duplicateMutation.mutate(),
                      disabled: duplicateMutation.isPending,
                    },
                  ]
                : []),
              ...(canCancel
                ? [
                    {
                      label: "Cancel order",
                      onSelect: () => setCancelOpen(true),
                      disabled: cancelMutation.isPending,
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    {
                      label: "Delete",
                      onSelect: () => setDeleteOpen(true),
                      disabled: deleteMutation.isPending,
                      destructive: true,
                    },
                  ]
                : []),
            ]}
          >
            <MoStageAction orderId={order.id} status={order.status} />
          </DetailPageActions>
        </div>

        <Separator />

        {order.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{order.notes}</p>
        )}

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Product</dt>
            <dd className="mt-1 text-sm">
              {order.productSku
                ? `${order.productName} (${order.productSku})`
                : order.productName}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Status</dt>
            <dd className="mt-1 text-sm">
              <ManufacturingOrderStatusBadge status={order.status} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Priority Rank</dt>
            <dd className="mt-1 text-sm">
              <PriorityRankEditor
                key={`${order.id}-${order.priorityRank ?? "none"}`}
                order={order}
                onUpdated={refreshQueries}
              />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader
                label="Planned Quantity"
                tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP}
              />
            </dt>
            <dd className="mt-1 text-sm">
              <QuantityWithUnit
                value={order.plannedQuantity}
                unitName={order.unitName}
              />
              {order.manufacturingMode === "batch" && order.numberOfBatches != null && (
                <span className="text-muted-foreground"> ({order.numberOfBatches} batch{order.numberOfBatches === 1 ? "" : "es"})</span>
              )}
            </dd>
          </div>
          {order.manufacturingMode === "batch" && order.expectedBatchYield != null && (
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Yield / Batch" tooltip={BATCH_YIELD_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">
              <QuantityWithUnit
                value={order.expectedBatchYield}
                unitName={order.unitName}
              />
            </dd>
          </div>
        )}
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Actual Quantity" tooltip={MANUFACTURING_ACTUAL_QTY_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">
              {order.actualQuantity != null
                ? (
                    <QuantityWithUnit
                      value={order.actualQuantity}
                      unitName={order.unitName}
                    />
                  )
                : "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Execution" tooltip={MANUFACTURING_EXECUTION_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">
              <ManufacturingPickProgressBadge status={order.pickProgressStatus} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Planned Date</dt>
            <dd className="mt-1 text-sm">{formatDate(order.plannedDate)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Sales Order" tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">
              {order.salesOrderNumber
                ? `${order.salesOrderNumber} - ${order.salesCustomerName ?? "\u2014"}`
                : "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.createdAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.updatedAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Released</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.releasedAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Completed</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.completedAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Material Cost" tooltip={MATERIAL_COST_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">
              {formatPrice(order.actualMaterialCost) ?? "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Cost / Unit" tooltip={COST_PER_UNIT_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">
              {formatPrice(order.actualCostPerUnit) ?? "\u2014"}
            </dd>
          </div>
        </dl>

        <Separator />

        {order.batches.length > 0 && (
          <>
            <div className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">Batches</h2>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">
                        <TooltipHeader label="Planned" tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP} />
                      </TableHead>
                      <TableHead className="text-right">
                        <TooltipHeader label="Actual" tooltip={MANUFACTURING_ACTUAL_QTY_TOOLTIP} />
                      </TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Completed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.batches.map((batch) => (
                      <TableRow key={batch.id}>
                        <TableCell>Batch {batch.batchNumber}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              batch.status === "completed"
                                ? "outline"
                                : batch.status === "in_progress"
                                  ? "default"
                                  : "secondary"
                            }
                          >
                            {batch.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatQuantity(batch.plannedQuantity)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatQuantity(batch.actualQuantity)}
                        </TableCell>
                        <TableCell>{formatDateTime(batch.startedAt, timeZone)}</TableCell>
                        <TableCell>{formatDateTime(batch.completedAt, timeZone)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <Separator />
          </>
        )}

        <IngredientsTable
          key={`${order.id}-${order.ingredients.map((ingredient) => ingredient.id).join(":")}`}
          order={order}
          onUpdated={refreshQueries}
        />

        <Separator />

        <OutputAllocationSection order={order} onUpdated={refreshQueries} />

        <Separator />

        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Produced Output</h2>
          {order.producedLots.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>
                      <TooltipHeader label="Lot" tooltip={LEDGER_LOT_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Quantity" tooltip={MANUFACTURING_ACTUAL_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Cost / Unit" tooltip={COST_PER_UNIT_TOOLTIP} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.producedLots.map((lot) => (
                    <TableRow key={lot.lotId}>
                      <TableCell>
                        {lot.batchNumber != null ? `Batch ${lot.batchNumber}` : "\u2014"}
                      </TableCell>
                      <TableCell className="font-mono">{lot.lotNumber}</TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(lot.quantity)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPrice(lot.costPerUnit) ?? "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No produced lot has been recorded yet.
            </p>
          )}
        </div>
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will remain in history, and released orders will stop
              contributing to expected quantity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft, completed, and cancelled orders can be soft-deleted and removed
              from normal views.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
