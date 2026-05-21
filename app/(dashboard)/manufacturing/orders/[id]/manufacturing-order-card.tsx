"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ICellRendererParams } from "ag-grid-community";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import {
  createManufacturingOrder,
  fetchManufacturingOrder,
  fetchSalesOrderManufacturingPreview,
  fetchSalesOrderOptions,
  patchManufacturingOrder,
  patchManufacturingOrderIngredient,
  reorderManufacturingOrderIngredients,
  saveManufacturingOrderIngredients,
} from "@/lib/api/clients/manufacturing-orders";
import { StatusPicker } from "@/components/manufacturing/status-picker";
import {
  LotStrategyChip,
  type PickedLotSummary,
} from "@/components/manufacturing/lot-strategy-chip";
import { ManufacturingIngredientLotCard } from "@/components/manufacturing/ingredient-lot-card";
import { CardPage, CardPageBody } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import {
  cardSaveMutationKey,
  saveStateFromEntityStatus,
  useEntitySaveStatus,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import {
  deriveProductionStatus,
  type ProductionStatus,
} from "@/lib/manufacturing/derive-status";
import type {
  ManufacturingOrderDetail,
  ManufacturingOrderIngredientDetail,
  ManufacturingOrderOperationCostDetail,
  ManufacturingSalesOrderPreviewLine,
} from "@/app/(dashboard)/manufacturing/types";
import type { ManufacturingLotStrategy } from "@/lib/schemas/manufacturing-orders";
import { cn } from "@/lib/utils";
import styles from "@/components/card-page/card-page.module.css";

export type ManufacturingProductOption = {
  id: string;
  name: string;
  sku: string | null;
  unitName: string;
  bom: Array<{ itemId: string; quantityPerUnit: string }>;
};

export function ManufacturingOrderCard({
  initialOrderId,
  initialOrder,
  productOptions = [],
}: {
  initialOrderId: string | null;
  initialOrder: ManufacturingOrderDetail | null;
  productOptions?: ManufacturingProductOption[];
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(initialOrderId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [lotPickerIngredient, setLotPickerIngredient] =
    useState<ManufacturingOrderIngredientDetail | null>(null);
  // Draft header fields (used until a product is chosen and the order created).
  const [draftPlannedQuantity, setDraftPlannedQuantity] = useState("1");
  const [draftPlannedDate, setDraftPlannedDate] = useState("");
  const goBack = useSmartBack("/manufacturing/orders");

  const isDraft = currentOrderId == null;

  const orderQuery = useQuery({
    queryKey: ["manufacturing-order", currentOrderId ?? "__draft__"],
    queryFn: () => fetchManufacturingOrder(currentOrderId as string),
    initialData: initialOrder ?? undefined,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const order = isDraft ? null : orderQuery.data ?? initialOrder;

  const salesOrderOptionsQuery = useQuery({
    queryKey: ["manufacturing-sales-order-options"],
    queryFn: fetchSalesOrderOptions,
    staleTime: 60_000,
  });
  const salesOrderOptions = salesOrderOptionsQuery.data ?? [];

  const refreshOrder = useCallback(() => {
    if (currentOrderId == null) return;
    void queryClient.invalidateQueries({ queryKey: ["manufacturing-order", currentOrderId] });
  }, [currentOrderId, queryClient]);

  const createMutation = useMutation({
    mutationKey: cardSaveMutationKey("manufacturing-order", "__draft__", "create"),
    mutationFn: createManufacturingOrder,
    onSuccess: (result) => {
      setCurrentOrderId(result.id);
      window.history.replaceState(null, "", `/manufacturing/orders/${result.id}`);
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-order", result.id] });
    },
  });

  const onPickProduct = (productId: string | null) => {
    if (!productId || createMutation.isPending) return;
    const product = productOptions.find((option) => option.id === productId);
    if (!product) return;
    const plannedQuantity = draftPlannedQuantity.trim() || "1";
    createMutation.mutate({
      productId,
      plannedQuantity,
      plannedDate: draftPlannedDate || null,
      ingredients: product.bom.map((row) => ({
        itemId: row.itemId,
        quantityPerUnit: row.quantityPerUnit,
      })),
    });
  };

  const duplicateMutation = useMutation({
    mutationKey: ["mo-action", currentOrderId ?? "__draft__", "duplicate"],
    mutationFn: async () => {
      const response = await fetch(
        `/api/manufacturing-orders/${currentOrderId}/duplicate`,
        { method: "POST", headers: createIdempotencyHeaders("manufacturing-order-duplicate") },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to duplicate order.");
      return body as { id: string };
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      router.push(`/manufacturing/orders/${created.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationKey: ["mo-action", currentOrderId ?? "__draft__", "delete"],
    mutationFn: async () => {
      const response = await fetch(`/api/manufacturing-orders/${currentOrderId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete order.");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      goBack();
    },
  });
  const lotAllocationMutation = useMutation({
    mutationKey: ["mo-action", currentOrderId ?? "__draft__", "ingredient-lot-allocation"],
    mutationFn: ({
      ingredientId,
      allocations,
    }: {
      ingredientId: string;
      allocations: Array<{ sourceId: string; quantity: string }>;
    }) =>
      patchManufacturingOrderIngredient(currentOrderId!, ingredientId, {
        lotStrategy: "custom",
        allocations,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["manufacturing-order", currentOrderId],
      });
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });

  const productionStatus: ProductionStatus | null = order
    ? deriveProductionStatus({
        status: order.status,
        isBlocked: order.isBlocked,
        pickProgressStatus: order.pickProgressStatus,
        completedBatchCount: order.batches.filter((batch) => batch.status === "completed")
          .length,
      })
    : null;

  const editState = getManufacturingOrderEditState(order);
  const saveStatus = useEntitySaveStatus("manufacturing-order", currentOrderId ?? "__draft__");
  const headerSaveState: CardSaveState = isDraft
    ? createMutation.isPending
      ? "saving"
      : createMutation.isError
        ? "failed"
        : "not_saved"
    : saveStateFromEntityStatus(saveStatus.status);
  const headerSaveMessage =
    isDraft && createMutation.isError
      ? createMutation.error instanceof Error
        ? createMutation.error.message
        : "Save failed"
      : null;

  return (
    <CardPage>
      <CardPageHeader
        title={
          order ? (
            <>
              <span>
                <span className={styles.mono}>{order.orderNumber}</span>
                {" "}
                <span className="ml-3">{order.productName}</span>
                {order.productSku ? (
                  <span
                    className={cn(
                      styles.mono,
                      "ml-2 text-[14px] font-medium text-[var(--color-muted)]",
                    )}
                  >
                    {" "}
                    / {order.productSku}
                  </span>
                ) : null}
              </span>
            </>
          ) : (
            <div className="mt-1 max-w-md">
              <Combobox
                items={productOptions.map((option) => option.id)}
                value=""
                onValueChange={(value) => onPickProduct(value || null)}
                itemToStringLabel={(value) =>
                  productOptions.find((option) => option.id === value)?.name ?? ""
                }
              >
                <ComboboxInput placeholder="Search or create product…" showClear />
                <ComboboxContent className="bg-popover text-popover-foreground">
                  <ComboboxEmpty>No manufacturable products found</ComboboxEmpty>
                  <ComboboxList>
                    {(id: string) => {
                      const option = productOptions.find((entry) => entry.id === id);
                      return (
                        <ComboboxItem key={id} value={id}>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate">{option?.name}</span>
                            {option?.sku ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {option.sku}
                              </span>
                            ) : null}
                          </div>
                        </ComboboxItem>
                      );
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
          )
        }
        meta={order ? <MoDescription order={order} /> : null}
        status={
          order && productionStatus ? (
            <StatusPicker orderId={order.id} current={productionStatus} onChanged={refreshOrder} />
          ) : null
        }
        saveState={headerSaveState}
        saveMessage={headerSaveMessage}
        showPrint
        printDisabled={!order}
        menuActions={
          order
            ? [
                {
                  label: "Open execution",
                  href: `/manufacturing/orders/${order.id}/execute`,
                },
                {
                  label: "Duplicate",
                  onClick: () => duplicateMutation.mutate(),
                  disabled: duplicateMutation.isPending,
                },
                {
                  label: "Delete order",
                  onClick: () => setDeleteOpen(true),
                  destructive: true,
                },
              ]
            : []
        }
        onClose={goBack}
        fallbackHref="/manufacturing/orders"
      />

      <CardPageBody>
        <OrderDetailsSection
          order={order}
          canEditMetadata={editState.canEditMetadata}
          canEditPlanning={editState.canEditPlanning}
          planningLockedReason={editState.planningLockedReason}
          draftPlannedQuantity={draftPlannedQuantity}
          draftPlannedDate={draftPlannedDate}
          onDraftPlannedQuantity={setDraftPlannedQuantity}
          onDraftPlannedDate={setDraftPlannedDate}
          salesOrderOptions={salesOrderOptions}
          onOpenSalesLink={() => setLinkDialogOpen(true)}
          onPatched={refreshOrder}
        />
        <IngredientsSection
          order={order}
          canEditPlanning={editState.canEditPlanning}
          planningLockedReason={editState.planningLockedReason}
          canEditLotAllocations={editState.canEditMetadata}
          metadataLockedReason={editState.metadataLockedReason}
          onOpenLotPicker={(ingredient) => setLotPickerIngredient(ingredient)}
          onChanged={refreshOrder}
        />
        <OperationsSection order={order} />
        <NotesSection
          order={order}
          canEdit={editState.canEditMetadata}
          lockedReason={editState.metadataLockedReason}
          onPatched={refreshOrder}
        />
      </CardPageBody>

      <SalesOrderLinkDialog
        open={linkDialogOpen}
        order={order}
        salesOrderOptions={salesOrderOptions}
        onOpenChange={setLinkDialogOpen}
        onLinked={refreshOrder}
      />

      {lotPickerIngredient ? (
        <Dialog
          open={lotPickerIngredient != null}
          onOpenChange={(open) => {
            if (!open) {
              setLotPickerIngredient(null);
              refreshOrder();
            }
          }}
        >
          <DialogContent size="lg" className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Pick lots for {lotPickerIngredient.itemName}</DialogTitle>
            </DialogHeader>
            <ManufacturingIngredientLotCard
              itemId={lotPickerIngredient.itemId}
              ingredientId={lotPickerIngredient.id}
              itemName={lotPickerIngredient.itemName}
              unitName={lotPickerIngredient.unitName}
              plannedQuantity={lotPickerIngredient.plannedQuantity}
              value={undefined}
              manufacturingOrderId={currentOrderId}
              autoAllocateOnSave={false}
              onChange={(allocations) => {
                lotAllocationMutation.mutate({
                  ingredientId: lotPickerIngredient.id,
                  allocations,
                });
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              Open orders are removed from normal views and reversible picked or
              reserved inventory is released. Production output blocks deletion.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardPage>
  );
}

function MoDescription({ order }: { order: ManufacturingOrderDetail }) {
  const actualNumber = order.actualQuantity != null ? Number(order.actualQuantity) : 0;
  const plannedNumber = Number(order.plannedQuantity);
  const progressPct =
    plannedNumber > 0 ? Math.min(100, Math.round((actualNumber / plannedNumber) * 100)) : 0;
  const materialCost = order.ingredients.reduce((total, ingredient) => {
    const cost = Number(ingredient.actualCostTotal ?? 0);
    return Number.isFinite(cost) ? total + cost : total;
  }, 0);
  const costPerUnit = actualNumber > 0 ? materialCost / actualNumber : null;
  return (
    <div className={styles.meta}>
      <span>
        Created{" "}
        <span className={styles.mono}>
          {formatDate(new Date(order.createdAt).toISOString().slice(0, 10))}
        </span>
      </span>
      <span className={styles.metaDot} />
      <span>
        Actual / Planned{" "}
        <span className={styles.mono}>
          {formatQuantity(order.actualQuantity ?? "0")} / {formatQuantity(order.plannedQuantity)}{" "}
          {order.unitName}
        </span>
      </span>
      <span className={styles.metaDot} />
      <span className={styles.mono}>{progressPct}%</span>
      <span className={styles.metaDot} />
      <span>
        Material cost <span className={styles.mono}>{formatPrice(materialCost.toFixed(4)) ?? "—"}</span>
      </span>
      <span className={styles.metaDot} />
      <span>
        Cost / unit{" "}
        <span className={styles.mono}>{costPerUnit == null ? "—" : formatPrice(costPerUnit.toFixed(4))}</span>
      </span>
    </div>
  );
}

function OrderDetailsSection({
  order,
  canEditMetadata,
  canEditPlanning,
  planningLockedReason,
  draftPlannedQuantity,
  draftPlannedDate,
  onDraftPlannedQuantity,
  onDraftPlannedDate,
  salesOrderOptions,
  onOpenSalesLink,
  onPatched,
}: {
  order: ManufacturingOrderDetail | null;
  canEditMetadata: boolean;
  canEditPlanning: boolean;
  planningLockedReason: string | null;
  draftPlannedQuantity: string;
  draftPlannedDate: string;
  onDraftPlannedQuantity: (value: string) => void;
  onDraftPlannedDate: (value: string) => void;
  salesOrderOptions: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    hasManufacturableLines?: boolean;
  }>;
  onOpenSalesLink: () => void;
  onPatched: () => void;
}) {
  const queryClient = useQueryClient();
  const unitName = order?.unitName ?? "";
  const groupSize = largestGroupSize(order);
  const groupCount =
    order && groupSize != null
      ? formatDecimal((Number(order.plannedQuantity) || 0) / groupSize)
      : null;
  const patchField = useMutation({
    mutationKey: cardSaveMutationKey("manufacturing-order", order?.id ?? "__draft__", "header"),
    mutationFn: (patch: Parameters<typeof patchManufacturingOrder>[1]) =>
      patchManufacturingOrder(order!.id, patch),
    onSuccess: () => {
      onPatched();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });
  const savePlannedQuantity = useMutation({
    mutationKey: cardSaveMutationKey("manufacturing-order", order?.id ?? "__draft__", "planned-quantity"),
    mutationFn: (plannedQuantity: string) =>
      saveManufacturingOrderIngredients(
        order!.id,
        {
          plannedQuantity,
          plannedDate: order!.plannedDate,
          notes: order!.notes,
          salesOrderId: order!.salesOrderId,
          salesOrderLineId: order!.salesOrderLineId,
        },
        order!.ingredients.map((ingredient) => ({
          itemId: ingredient.itemId,
          quantityPerUnit: ingredient.quantityPerUnit,
        })),
      ),
    onSuccess: () => {
      onPatched();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>Order details</h2>
      <div className={styles.formRow}>
        <FormField label="Product" required>
          <div className={styles.readOnlyFieldValue}>
            {order?.productName ?? "Choose a product to create this order"}
          </div>
          {order ? (
            <div className={styles.fieldMeta}>
              SKU {order.productSku ?? "—"} · {unitName || "unit"}
            </div>
          ) : null}
        </FormField>
        <FormField label="Production deadline" required>
          {canEditMetadata ? (
            <DatePicker
              aria-label="Planned date"
              value={order ? order.plannedDate ?? "" : draftPlannedDate}
              className={styles.underlineControl}
              onChange={(next) => {
                const normalized = next || null;
                if (order) {
                  if (normalized !== order.plannedDate) patchField.mutate({ plannedDate: normalized });
                } else {
                  onDraftPlannedDate(next);
                }
              }}
            />
          ) : (
            <div
              className={`${styles.readOnlyFieldValue} ${styles.mono}`}
              title="Completed manufacturing orders are historical records."
            >
              {order?.plannedDate ? formatDate(order.plannedDate) : "—"}
            </div>
          )}
          <div className={styles.fieldHint}>Target completion date.</div>
        </FormField>
        <FormField label="Manufacturing location">
          <div className={styles.readOnlyFieldValue}>Default location</div>
          <div className={styles.fieldHint}>Floor / yard where this order runs.</div>
        </FormField>
      </div>
      <div className={styles.formRow}>
        <FormField label={groupSize != null ? "Groups" : "Planned quantity"} required>
          {canEditPlanning ? (
            <div className={styles.suffixField}>
              <Input
                key={`${order?.plannedQuantity ?? "draft"}-${groupSize ?? "output"}`}
                defaultValue={groupCount ?? (order ? order.plannedQuantity : draftPlannedQuantity)}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (!next) return;
                  const savedQuantity =
                    groupSize != null
                      ? formatDecimal((Number(next) || 0) * groupSize)
                      : next;
                  if (order) {
                    if (savedQuantity !== order.plannedQuantity) {
                      savePlannedQuantity.mutate(savedQuantity);
                    }
                  } else {
                    onDraftPlannedQuantity(savedQuantity);
                  }
                }}
                inputMode="decimal"
                className={`${styles.underlineInput} ${styles.mono} text-right`}
                aria-label={groupSize != null ? "Groups" : "Planned quantity"}
              />
              <span className={styles.fieldSuffix}>
                {groupSize != null ? "groups" : unitName}
              </span>
            </div>
          ) : (
            <div
              className={`${styles.suffixField} ${styles.suffixFieldReadOnly}`}
              title={planningLockedReason ?? undefined}
            >
              <span className={`${styles.underlineInput} ${styles.mono} text-right`}>
                {groupCount ?? (order ? formatQuantity(order.plannedQuantity) : "—")}
              </span>
              <span className={styles.fieldSuffix}>
                {groupSize != null ? "groups" : unitName}
              </span>
            </div>
          )}
          {groupSize != null ? (
            <div className={styles.fieldHint}>
              {formatQuantity(formatDecimal(groupSize))} {unitName} per group ·{" "}
              {order ? formatQuantity(order.plannedQuantity) : "—"} {unitName} planned
            </div>
          ) : null}
        </FormField>
        <FormField label="Group size">
          <div className={`${styles.suffixField} ${styles.suffixFieldReadOnly}`}>
            <span className={`${styles.underlineInput} ${styles.mono} text-right`}>
              {groupSize != null ? formatQuantity(formatDecimal(groupSize)) : "—"}
            </span>
            {unitName ? <span className={styles.fieldSuffix}>{unitName}</span> : null}
          </div>
          <div className={styles.fieldHint}>
            {groupSize != null ? "Largest group from product recipe." : "No grouped recipe rows."}
          </div>
        </FormField>
        <FormField label="Sales order">
          {order?.salesOrderNumber && order.salesOrderId ? (
            <div className={styles.readOnlyFieldValue}>
              <Link
                href={`/sales/orders/${order.salesOrderId}`}
                className={styles.fieldLink}
              >
                {order.salesOrderNumber}
              </Link>
              {order.salesCustomerName ? ` · ${order.salesCustomerName}` : null}
            </div>
          ) : (
            <div className={styles.readOnlyFieldValue}>No sales order — make to stock</div>
          )}
          {order ? (
            canEditPlanning ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-(--space-2) h-(--height-input-sm)"
                onClick={onOpenSalesLink}
                disabled={salesOrderOptions.length === 0}
              >
                {order.salesOrderId ? "Change link" : "Link sales order"}
              </Button>
            ) : (
              <span title={planningLockedReason ?? undefined}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-(--space-2) h-(--height-input-sm)"
                  disabled
                >
                  {order.salesOrderId ? "Change link" : "Link sales order"}
                </Button>
              </span>
            )
          ) : null}
          <div className={styles.fieldHint}>Link one customer order line.</div>
        </FormField>
      </div>
    </section>
  );
}

function largestGroupSize(order: ManufacturingOrderDetail | null) {
  if (!order) return null;
  const sizes = order.ingredients
    .filter(
      (ingredient) =>
        ingredient.consumptionMode === "per_group" &&
        ingredient.basisOutputQuantity != null,
    )
    .map((ingredient) => Number(ingredient.basisOutputQuantity))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (sizes.length === 0) return null;
  return Math.max(...sizes);
}

function formatDecimal(value: number) {
  if (!Number.isFinite(value)) return "";
  return value
    .toFixed(6)
    .replace(/\.?0+$/, "");
}

function getManufacturingOrderEditState(order: ManufacturingOrderDetail | null) {
  const metadataLockedReason =
    order?.status === "done"
      ? "Completed manufacturing orders are historical records."
      : null;
  const executionStartedReason = getManufacturingExecutionStartedReason(order);
  const planningLockedReason = metadataLockedReason ?? executionStartedReason;

  return {
    canEditMetadata: order == null || order.status === "open",
    canEditPlanning: order == null || (order.status === "open" && executionStartedReason == null),
    metadataLockedReason,
    planningLockedReason,
  };
}

function getManufacturingExecutionStartedReason(order: ManufacturingOrderDetail | null) {
  if (!order) return null;

  if (order.producedLots.length > 0 || Number(order.actualQuantity ?? 0) > 0) {
    return "Output has already been recorded, so planning fields are locked to preserve inventory history.";
  }

  if (
    order.batches.some(
      (batch) =>
        batch.status !== "pending" ||
        batch.startedAt != null ||
        batch.pickedAt != null ||
        batch.completedAt != null,
    )
  ) {
    return "Batch work has started, so planning fields are locked to preserve execution history.";
  }

  if (
    order.ingredients.some(
      (ingredient) =>
        ingredient.pickStatus !== "not_picked" ||
        Number(ingredient.pickedQuantity) > 0 ||
        ingredient.actualQuantity != null,
    )
  ) {
    return "Ingredients have already been picked, so planning fields are locked to preserve inventory history.";
  }

  return null;
}

function SalesOrderLinkDialog({
  open,
  order,
  salesOrderOptions,
  onOpenChange,
  onLinked,
}: {
  open: boolean;
  order: ManufacturingOrderDetail | null;
  salesOrderOptions: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    hasManufacturableLines?: boolean;
    disabledReason?: string | null;
  }>;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedOrderId, setSelectedOrderId] = useState(order?.salesOrderId ?? "");
  const [selectedLineId, setSelectedLineId] = useState(order?.salesOrderLineId ?? "");
  const previewQuery = useQuery({
    queryKey: ["manufacturing-sales-order-preview", selectedOrderId],
    queryFn: () => fetchSalesOrderManufacturingPreview(selectedOrderId),
    enabled: open && selectedOrderId.length > 0,
  });
  const preview = previewQuery.data;
  const selectedLine = preview?.lines.find(
    (line) => line.salesOrderLineId === selectedLineId,
  );
  const linkMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "manufacturing-order",
      order?.id ?? "__draft__",
      "sales-link",
    ),
    mutationFn: (line: ManufacturingSalesOrderPreviewLine) =>
      saveManufacturingOrderIngredients(
        order!.id,
        {
          plannedQuantity: line.quantity,
          plannedDate: preview?.shipDate ?? preview?.requestedDate ?? order!.plannedDate,
          notes: order!.notes,
          salesOrderId: preview!.salesOrderId,
          salesOrderLineId: line.salesOrderLineId,
        },
        order!.ingredients.map((ingredient) => ({
          itemId: ingredient.itemId,
          quantityPerUnit: ingredient.quantityPerUnit,
        })),
      ),
    onSuccess: () => {
      onLinked();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      onOpenChange(false);
    },
  });
  const unlinkMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "manufacturing-order",
      order?.id ?? "__draft__",
      "sales-unlink",
    ),
    mutationFn: () => patchManufacturingOrder(order!.id, {
      salesOrderId: null,
      salesOrderLineId: null,
    }),
    onSuccess: () => {
      onLinked();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setSelectedOrderId(order?.salesOrderId ?? "");
          setSelectedLineId(order?.salesOrderLineId ?? "");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link sales order</DialogTitle>
          <DialogDescription>
            Select one open sales order line for this manufacturing order.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-(--space-4)">
          <FormField label="Sales order">
            <Combobox
              items={salesOrderOptions.map((option) => option.id)}
              value={selectedOrderId}
              onValueChange={(value) => {
                setSelectedOrderId(value ?? "");
                setSelectedLineId("");
              }}
              itemToStringLabel={(value) => {
                const option = salesOrderOptions.find((entry) => entry.id === value);
                return option ? `${option.orderNumber} (${option.customerName})` : "";
              }}
            >
              <ComboboxInput
                placeholder="Search open sales orders"
                showClear
                className={styles.underlineControl}
              />
              <ComboboxContent className="bg-popover text-popover-foreground">
                <ComboboxEmpty>No open sales orders</ComboboxEmpty>
                <ComboboxList>
                  {(id: string) => {
                    const option = salesOrderOptions.find((entry) => entry.id === id);
                    return (
                      <ComboboxItem
                        key={id}
                        value={id}
                        disabled={option?.hasManufacturableLines === false}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">
                            {option ? `${option.orderNumber} (${option.customerName})` : id}
                          </span>
                          {option?.disabledReason ? (
                            <span className="text-xs text-[var(--color-muted-2)]">
                              {option.disabledReason}
                            </span>
                          ) : null}
                        </div>
                      </ComboboxItem>
                    );
                  }}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </FormField>

          {selectedOrderId ? (
            <div className="space-y-(--space-2)">
              <div className={styles.formLabel}>Line item</div>
              {previewQuery.isLoading ? (
                <div className={styles.readOnlyFieldValue}>Loading lines…</div>
              ) : preview?.lines.length ? (
                <div className="max-h-72 overflow-auto border border-[var(--color-line)]">
                  {preview.lines.map((line) => {
                    const productMismatch = order != null && line.itemId !== order.productId;
                    const disabled = line.status !== "will_create" || productMismatch;
                    return (
                      <button
                        key={line.salesOrderLineId}
                        type="button"
                        disabled={disabled}
                        onClick={() => setSelectedLineId(line.salesOrderLineId)}
                        className={cn(
                          "flex w-full items-center justify-between gap-(--space-3) border-b border-[var(--color-line)] px-(--space-3) py-(--space-2) text-left text-sm last:border-b-0",
                          selectedLineId === line.salesOrderLineId
                            ? "bg-[var(--color-accent-soft)]"
                            : "bg-card",
                          disabled ? "opacity-50" : "hover:bg-muted",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{line.itemName}</span>
                          <span className="block truncate text-xs text-[var(--color-muted-2)]">
                            {[line.itemSku, line.skipMessage, productMismatch ? "Different product" : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className={`${styles.mono} shrink-0`}>
                          {formatQuantity(line.quantity)} {line.unitName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.readOnlyFieldValue}>No manufacturable lines.</div>
              )}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {order?.salesOrderId ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => unlinkMutation.mutate()}
              disabled={unlinkMutation.isPending || linkMutation.isPending}
            >
              Unlink
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => selectedLine && linkMutation.mutate(selectedLine)}
            disabled={!selectedLine || linkMutation.isPending || unlinkMutation.isPending}
          >
            Link line
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.formField}>
      <label className={styles.formLabel}>
        {label}
        {required ? <span className={styles.requiredMark}> *</span> : null}
      </label>
      {children}
    </div>
  );
}

function IngredientsSection({
  order,
  canEditPlanning,
  planningLockedReason,
  canEditLotAllocations,
  metadataLockedReason,
  onOpenLotPicker,
  onChanged,
}: {
  order: ManufacturingOrderDetail | null;
  canEditPlanning: boolean;
  planningLockedReason: string | null;
  canEditLotAllocations: boolean;
  metadataLockedReason: string | null;
  onOpenLotPicker: (ingredient: ManufacturingOrderIngredientDetail) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] =
    useState<ManufacturingOrderIngredientDetail | null>(null);

  const ingredients = useMemo(() => order?.ingredients ?? [], [order]);
  const [rows, setRows] = useState<ManufacturingOrderIngredientDetail[]>(ingredients);
  const [lastSynced, setLastSynced] = useState(ingredients);
  if (lastSynced !== ingredients) {
    setLastSynced(ingredients);
    setRows(ingredients);
  }

  const materialCost = ingredients.reduce((total, ingredient) => {
    const cost = Number(ingredient.actualCostTotal ?? 0);
    return Number.isFinite(cost) ? total + cost : total;
  }, 0);

  const reorderMutation = useMutation({
    mutationKey: cardSaveMutationKey("manufacturing-order", order?.id ?? "__draft__", "ingredient-reorder"),
    mutationFn: (ids: string[]) => reorderManufacturingOrderIngredients(order!.id, ids),
    onSettled: onChanged,
  });

  const saveIngredientsMutation = useMutation({
    mutationKey: cardSaveMutationKey("manufacturing-order", order?.id ?? "__draft__", "ingredient-save"),
    mutationFn: (next: ManufacturingOrderIngredientDetail[]) =>
      saveManufacturingOrderIngredients(
        order!.id,
        {
          plannedQuantity: order!.plannedQuantity,
          plannedDate: order!.plannedDate,
          notes: order!.notes,
          salesOrderId: order!.salesOrderId,
          salesOrderLineId: order!.salesOrderLineId,
        },
        next.map((row) => ({ itemId: row.itemId, quantityPerUnit: row.quantityPerUnit })),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      onChanged();
    },
  });

  const handleRowsChange = useCallback(
    (
      next: ManufacturingOrderIngredientDetail[],
      change: EditableLineDataGridChange<ManufacturingOrderIngredientDetail>,
    ) => {
      setRows(next);
      if (change.type === "row_reordered" && order) {
        reorderMutation.mutate(next.map((row) => row.id));
      }
    },
    [order, reorderMutation],
  );

  const columns = useMemo<ColDef<ManufacturingOrderIngredientDetail>[]>(
    () => [
      {
        colId: "ingredient",
        headerName: "Ingredient",
        flex: 1.5,
        minWidth: 220,
        valueGetter: (params) => params.data?.itemName ?? "",
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          if (!params.data) return null;
          const sub = [params.data.itemType, params.data.unitName].filter(Boolean).join(" · ");
          return (
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-medium text-[var(--color-ink)]">
                {params.data.itemName}
              </span>
              {sub ? (
                <span className="text-[11px] text-[var(--color-muted)] capitalize">{sub}</span>
              ) : null}
            </div>
          );
        },
      },
      {
        field: "itemSku",
        headerName: "SKU",
        width: 130,
        cellClass: styles.sku,
        valueFormatter: ({ value }) => (value ? String(value) : "—"),
      },
      {
        field: "plannedQuantity",
        headerName: "Planned",
        type: "rightAligned",
        width: 120,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) =>
          params.data ? (
            <span>
              <span className={styles.mono}>{formatQuantity(params.data.plannedQuantity)}</span>
              <span className={styles.uom}>{params.data.unitName}</span>
            </span>
          ) : null,
      },
      {
        colId: "pickedActual",
        headerName: "Picked / Actual",
        type: "rightAligned",
        width: 140,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          if (!params.data) return null;
          return (
            <div className="flex flex-col items-end leading-tight">
              <span className={styles.mono}>
                {formatQuantity(params.data.pickedQuantity)} /{" "}
                {params.data.actualQuantity != null
                  ? formatQuantity(params.data.actualQuantity)
                  : "—"}
              </span>
              <span className="text-[11px] text-[var(--color-muted)]">
                of {formatQuantity(params.data.plannedQuantity)}
              </span>
            </div>
          );
        },
      },
      {
        colId: "lotAllocation",
        headerName: "Lot allocation",
        flex: 1.2,
        minWidth: 240,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          if (!params.data || !order) return null;
          const ingredient = params.data;
          const picked = Number(ingredient.pickedQuantity);
          const canEditIngredientLots =
            canEditLotAllocations &&
            ingredient.pickStatus === "not_picked" &&
            (!Number.isFinite(picked) || picked <= 0);
          const lotLockReason = !canEditLotAllocations
            ? metadataLockedReason
            : "Lot allocations cannot be changed after this ingredient has been picked.";
          const summary: PickedLotSummary = {
            count: Number.isFinite(picked) && picked > 0 ? 1 : 0,
            firstLot: null,
            totalQty:
              Number.isFinite(picked) && picked > 0
                ? formatQuantity(ingredient.pickedQuantity)
                : null,
          };
          if (!canEditIngredientLots) {
            return (
              <span
                className="text-[11.5px] text-[var(--color-muted)]"
                title={lotLockReason ?? undefined}
              >
                {summary.count} lot{summary.count === 1 ? "" : "s"}
              </span>
            );
          }
          return (
            <LotStrategyChip
              orderId={order.id}
              ingredientId={ingredient.id}
              strategy={ingredient.lotStrategy as ManufacturingLotStrategy}
              summary={summary}
              onOpenPicker={() => onOpenLotPicker(ingredient)}
            />
          );
        },
      },
      {
        field: "actualCostTotal",
        headerName: "Cost",
        type: "rightAligned",
        width: 110,
        cellClass: styles.mono,
        valueFormatter: ({ value }) => (value != null ? (formatPrice(String(value)) ?? "—") : "—"),
      },
      {
        colId: "requirements",
        headerName: "Requirements",
        width: 160,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          const constraints = params.data?.constraints ?? [];
          if (constraints.length === 0) return <span className={styles.placeholder}>—</span>;
          return (
            <span className="inline-flex flex-wrap gap-1">
              {constraints.map((constraint, index) => (
                <span
                  key={index}
                  className="inline-flex h-5 items-center bg-[var(--color-warning-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--color-warning)]"
                >
                  {constraint.constraintType === "lot_age_min_days"
                    ? `≥ ${constraint.config.days}d age`
                    : constraint.constraintType}
                </span>
              ))}
            </span>
          );
        },
      },
    ],
    [canEditLotAllocations, metadataLockedReason, onOpenLotPicker, order],
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Ingredients
        <span className="count">
          {ingredients.length} item{ingredients.length === 1 ? "" : "s"}
          {materialCost > 0 ? ` · ${formatPrice(String(materialCost))} material cost` : ""}
        </span>
      </h2>
      <EditableLineDataGrid<ManufacturingOrderIngredientDetail>
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={() => rows[0]!}
        onRowsChange={handleRowsChange}
        addLabel="Add ingredient"
        emptyMessage="No ingredients yet. Pick a product to populate the bill of materials."
        enableAddRow={false}
        enableReorder={canEditPlanning && order != null}
        enableDelete={canEditPlanning && order != null}
        canDeleteRow={(_row, current) => current.length > 1}
        getDeleteDisabledReason={(_row, current) =>
          !canEditPlanning
            ? planningLockedReason
            : current.length <= 1
              ? "An order needs at least one ingredient."
              : null
        }
        onDeleteRow={(row) => setConfirmDelete(row)}
        headerHeight={36}
        rowHeight={46}
        minHeight={110}
      />

      <AlertDialog
        open={confirmDelete != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove ingredient?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.itemName} will be removed from this order.
              {saveIngredientsMutation.error ? (
                <span className="block mt-(--space-2) text-destructive">
                  {(saveIngredientsMutation.error as Error).message}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => saveIngredientsMutation.reset()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={saveIngredientsMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!confirmDelete) return;
                const next = rows.filter((row) => row.id !== confirmDelete.id);
                saveIngredientsMutation.mutate(next, {
                  onSuccess: () => setConfirmDelete(null),
                });
              }}
            >
              {saveIngredientsMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function OperationsSection({ order }: { order: ManufacturingOrderDetail | null }) {
  const operations = useMemo(() => order?.operationCosts ?? [], [order]);
  const [rows, setRows] = useState<ManufacturingOrderOperationCostDetail[]>(operations);
  const [lastSynced, setLastSynced] = useState(operations);
  if (lastSynced !== operations) {
    setLastSynced(operations);
    setRows(operations);
  }

  const columns = useMemo<ColDef<ManufacturingOrderOperationCostDetail>[]>(
    () => [
      { field: "operationName", headerName: "Operation step", flex: 1.4, minWidth: 200 },
      { field: "resourceName", headerName: "Resource", flex: 1, minWidth: 160 },
      {
        colId: "time",
        headerName: "Time (actual / planned)",
        type: "rightAligned",
        width: 180,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderOperationCostDetail>) => {
          if (!params.data) return null;
          return (
            <div className="flex flex-col items-end leading-tight">
              <span className={styles.mono}>
                — / {formatQuantity(params.data.plannedMinutes)}
              </span>
              <span className="text-[11px] text-[var(--color-muted)]">minutes</span>
            </div>
          );
        },
      },
      {
        field: "plannedCostTotal",
        headerName: "Cost",
        type: "rightAligned",
        width: 120,
        cellClass: styles.mono,
        valueFormatter: ({ value }) => formatPrice(String(value)) ?? "—",
      },
    ],
    [],
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Operations
        <span className="count">
          {operations.length} step{operations.length === 1 ? "" : "s"}
        </span>
      </h2>
      <EditableLineDataGrid<ManufacturingOrderOperationCostDetail>
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={() => rows[0]!}
        onRowsChange={setRows}
        addLabel="Add operation"
        emptyMessage="No operations for this product."
        enableAddRow={false}
        enableReorder={false}
        enableDelete={false}
        headerHeight={36}
        rowHeight={42}
        minHeight={96}
      />
    </section>
  );
}

function NotesSection({
  order,
  canEdit,
  lockedReason,
  onPatched,
}: {
  order: ManufacturingOrderDetail | null;
  canEdit: boolean;
  lockedReason: string | null;
  onPatched: () => void;
}) {
  const patchNotes = useMutation({
    mutationKey: cardSaveMutationKey("manufacturing-order", order?.id ?? "__draft__", "notes"),
    mutationFn: (value: string | null) => patchManufacturingOrder(order!.id, { notes: value }),
    onSuccess: onPatched,
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Notes
        <span className="hint">internal only</span>
      </h2>
      {canEdit ? (
        <Textarea
          key={order?.id ?? "draft"}
          aria-label="Notes"
          defaultValue={order?.notes ?? ""}
          onBlur={(event) => {
            if (!order) return;
            const next = event.target.value.trim() || null;
            if (next !== order.notes) patchNotes.mutate(next);
          }}
          rows={3}
          disabled={!order}
          className="min-h-20 border-[var(--color-line)] focus-visible:ring-[var(--color-accent)]"
          placeholder="Notes for this order…"
        />
      ) : (
        <div
          className="min-h-20 border border-[var(--color-line)] bg-[var(--color-surface-alt)] p-3 text-[13px] text-[var(--color-ink)] whitespace-pre-wrap"
          title={lockedReason ?? undefined}
        >
          {order?.notes ?? <span className="text-[var(--color-muted)]">No notes.</span>}
        </div>
      )}
    </section>
  );
}
