"use client";

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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import {
  createManufacturingOrder,
  fetchManufacturingSalesLineOptions,
  fetchManufacturingOrder,
  patchManufacturingOrder,
  patchManufacturingOrderIngredient,
  reorderManufacturingOrderIngredients,
  saveManufacturingOrderIngredients,
} from "@/lib/api/clients/manufacturing-orders";
import { ManufacturingStatusControl } from "@/components/manufacturing/manufacturing-status-control";
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
import type {
  ManufacturingOrderDetail,
  ManufacturingOrderIngredientDetail,
  ManufacturingOrderOperationCostDetail,
} from "@/app/(dashboard)/manufacturing/types";
import type { ManufacturingLotStrategy } from "@/lib/schemas/manufacturing-orders";
import { cn } from "@/lib/utils";
import styles from "@/components/card-page/card-page.module.css";

export type ManufacturingProductOption = {
  id: string;
  name: string;
  displayName?: string;
  sku: string | null;
  unitName: string;
  manufacturingMode: string;
  expectedBatchYield: string | null;
  bom: Array<{ itemId: string; quantityPerUnit: string }>;
};

const MAKE_TO_STOCK_VALUE = "__make_to_stock__";

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
  const [lotPickerIngredient, setLotPickerIngredient] =
    useState<ManufacturingOrderIngredientDetail | null>(null);
  // Draft header fields (used until a product is chosen and the order created).
  const [draftProductId, setDraftProductId] = useState("");
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
    setDraftProductId(productId);
    const plannedQuantity = resolvePlannedOutputQuantity({
      inputQuantity: draftPlannedQuantity.trim() || "1",
      manufacturingMode: product.manufacturingMode,
      expectedBatchYield: product.expectedBatchYield,
    });
    if (!plannedQuantity) return;
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
            "New manufacturing order"
          )
        }
        meta={order ? <MoDescription order={order} /> : null}
        statusControl={
          order ? (
            <ManufacturingStatusControl
              order={{
                id: order.id,
                status: order.status,
                isBlocked: order.isBlocked,
                manufacturingMode: order.manufacturingMode,
                pickProgressStatus: order.pickProgressStatus,
                completedBatchCount: order.batches.filter(
                  (batch) => batch.status === "completed",
                ).length,
                actualQuantity: order.actualQuantity,
              }}
              onChanged={refreshOrder}
            />
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
          productOptions={productOptions}
          draftProductId={draftProductId}
          canEditMetadata={editState.canEditMetadata}
          canEditPlanning={editState.canEditPlanning}
          planningLockedReason={editState.planningLockedReason}
          draftPlannedQuantity={draftPlannedQuantity}
          draftPlannedDate={draftPlannedDate}
          onDraftPlannedQuantity={setDraftPlannedQuantity}
          onDraftPlannedDate={setDraftPlannedDate}
          onDraftPickProduct={onPickProduct}
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
  productOptions,
  draftProductId,
  canEditMetadata,
  canEditPlanning,
  planningLockedReason,
  draftPlannedQuantity,
  draftPlannedDate,
  onDraftPlannedQuantity,
  onDraftPlannedDate,
  onDraftPickProduct,
  onPatched,
}: {
  order: ManufacturingOrderDetail | null;
  productOptions: ManufacturingProductOption[];
  draftProductId: string;
  canEditMetadata: boolean;
  canEditPlanning: boolean;
  planningLockedReason: string | null;
  draftPlannedQuantity: string;
  draftPlannedDate: string;
  onDraftPlannedQuantity: (value: string) => void;
  onDraftPlannedDate: (value: string) => void;
  onDraftPickProduct: (productId: string | null) => void;
  onPatched: () => void;
}) {
  const queryClient = useQueryClient();
  const unitName = order?.unitName ?? "";
  const salesLineOptionsQuery = useQuery({
    queryKey: ["manufacturing-sales-line-options", order?.productId ?? "__draft__"],
    queryFn: () => fetchManufacturingSalesLineOptions(order!.productId),
    enabled: order != null,
    staleTime: 60_000,
  });
  const salesLineOptions = salesLineOptionsQuery.data ?? [];
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
    mutationFn: (inputQuantity: string) => {
      const plannedQuantity = resolvePlannedOutputQuantity({
        inputQuantity,
        manufacturingMode: order!.manufacturingMode,
        expectedBatchYield: order!.expectedBatchYield,
      });
      if (!plannedQuantity) throw new Error("Enter a whole number of batches.");
      return saveManufacturingOrderIngredients(
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
      );
    },
    onSuccess: () => {
      onPatched();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });
  const saveOrderSnapshot = useMutation({
    mutationKey: cardSaveMutationKey("manufacturing-order", order?.id ?? "__draft__", "snapshot"),
    mutationFn: (input: {
      productId?: string;
      plannedQuantity: string;
      plannedDate: string | null;
      salesOrderId: string | null;
      salesOrderLineId: string | null;
      ingredients: Array<{ itemId: string; quantityPerUnit: string }>;
    }) =>
      saveManufacturingOrderIngredients(
        order!.id,
        {
          productId: input.productId,
          plannedQuantity: input.plannedQuantity,
          plannedDate: input.plannedDate,
          notes: order!.notes,
          salesOrderId: input.salesOrderId,
          salesOrderLineId: input.salesOrderLineId,
        },
        input.ingredients,
      ),
    onSuccess: () => {
      onPatched();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      void queryClient.invalidateQueries({
        queryKey: ["manufacturing-sales-line-options", order?.productId ?? "__draft__"],
      });
    },
  });

  const selectedProductId = order?.productId ?? draftProductId;
  const selectedProduct = productOptions.find((option) => option.id === selectedProductId);
  const isBatchProduct =
    order?.manufacturingMode === "batch" || selectedProduct?.manufacturingMode === "batch";
  const expectedBatchYield = order?.expectedBatchYield ?? selectedProduct?.expectedBatchYield ?? null;
  const plannedInputValue =
    order?.manufacturingMode === "batch" && order.numberOfBatches != null
      ? String(order.numberOfBatches)
      : order
        ? order.plannedQuantity
        : draftPlannedQuantity;
  const plannedFieldLabel = isBatchProduct ? "Batches" : "Planned quantity";
  const plannedFieldSuffix = isBatchProduct ? "batches" : unitName;
  const productSelectDisabled =
    saveOrderSnapshot.isPending || productOptions.length === 0;

  const handleProductChange = (productId: string) => {
    const product = productOptions.find((option) => option.id === productId);
    if (!product) return;

    if (!order) {
      onDraftPickProduct(productId);
      return;
    }

    if (productId === order.productId || !canEditPlanning) return;

    const plannedQuantity = resolvePlannedOutputQuantity({
      inputQuantity:
        product.manufacturingMode === "batch"
          ? "1"
          : order.manufacturingMode === "batch" && order.numberOfBatches != null
            ? String(order.numberOfBatches)
            : order.plannedQuantity,
      manufacturingMode: product.manufacturingMode,
      expectedBatchYield: product.expectedBatchYield,
    });
    if (!plannedQuantity) return;

    saveOrderSnapshot.mutate({
      productId,
      plannedQuantity,
      plannedDate: order.plannedDate,
      salesOrderId: null,
      salesOrderLineId: null,
      ingredients: product.bom.map((row) => ({
        itemId: row.itemId,
        quantityPerUnit: row.quantityPerUnit,
      })),
    });
  };

  const handleSalesLineChange = (value: string) => {
    if (!order || !canEditPlanning) return;
    if (value === MAKE_TO_STOCK_VALUE) {
      if (!order.salesOrderId && !order.salesOrderLineId) return;
      patchField.mutate({ salesOrderId: null, salesOrderLineId: null });
      return;
    }

    const line = salesLineOptions.find((option) => option.salesOrderLineId === value);
    if (!line || line.salesOrderLineId === order.salesOrderLineId) return;
    const plannedQuantity = resolvePlannedOutputQuantity({
      inputQuantity:
        order.manufacturingMode === "batch"
          ? String(Math.ceil(Number(line.quantity) / Number(order.expectedBatchYield)))
          : line.quantity,
      manufacturingMode: order.manufacturingMode,
      expectedBatchYield: order.expectedBatchYield,
    });
    if (!plannedQuantity) return;

    saveOrderSnapshot.mutate({
      plannedQuantity,
      plannedDate: line.shipDate ?? line.requestedDate ?? order.plannedDate,
      salesOrderId: line.salesOrderId,
      salesOrderLineId: line.salesOrderLineId,
      ingredients: order.ingredients.map((ingredient) => ({
        itemId: ingredient.itemId,
        quantityPerUnit: ingredient.quantityPerUnit,
      })),
    });
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>Order details</h2>
      <div className={styles.formRow}>
        <FormField label="Product" required>
          {canEditPlanning ? (
            <Select
              value={selectedProductId}
              onValueChange={handleProductChange}
              disabled={productSelectDisabled}
            >
              <SelectTrigger
                aria-label="Product"
                className={`${styles.underlineControl} w-full justify-between`}
              >
                <SelectValue placeholder="Select product" />
              </SelectTrigger>
              <SelectContent>
                {productOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {productLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className={styles.readOnlyFieldValue} title={planningLockedReason ?? undefined}>
              {order?.productName ?? "Select product"}
            </div>
          )}
          {order || selectedProduct ? (
            <div className={styles.fieldMeta}>
              SKU {order?.productSku ?? selectedProduct?.sku ?? "—"} ·{" "}
              {unitName || selectedProduct?.unitName || "unit"}
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
        <FormField label={plannedFieldLabel} required>
          {canEditPlanning ? (
            <div className={styles.suffixField}>
              <Input
                key={order ? plannedInputValue : `draft-${selectedProductId}`}
                defaultValue={plannedInputValue}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (!next) return;
                  if (order) {
                    if (next !== plannedInputValue) {
                      savePlannedQuantity.mutate(next);
                    }
                  } else {
                    onDraftPlannedQuantity(next);
                  }
                }}
                inputMode={isBatchProduct ? "numeric" : "decimal"}
                className={`${styles.underlineInput} ${styles.mono} text-right`}
                aria-label={plannedFieldLabel}
              />
              <span className={styles.fieldSuffix}>{plannedFieldSuffix}</span>
            </div>
          ) : (
            <div
              className={`${styles.suffixField} ${styles.suffixFieldReadOnly}`}
              title={planningLockedReason ?? undefined}
            >
              <span className={`${styles.underlineInput} ${styles.mono} text-right`}>
                {order ? formatQuantity(plannedInputValue) : "—"}
              </span>
              <span className={styles.fieldSuffix}>{plannedFieldSuffix}</span>
            </div>
          )}
          {isBatchProduct ? (
            <div className={styles.fieldHint}>
              Expected output: {expectedBatchYield ?? "—"}{" "}
              {unitName || selectedProduct?.unitName || "unit"} per batch.
            </div>
          ) : null}
        </FormField>
        <FormField label="Sales order">
          {order && canEditPlanning ? (
            <Select
              value={order.salesOrderLineId ?? MAKE_TO_STOCK_VALUE}
              onValueChange={handleSalesLineChange}
              disabled={saveOrderSnapshot.isPending || salesLineOptionsQuery.isLoading}
            >
              <SelectTrigger
                aria-label="Sales order"
                className={`${styles.underlineControl} w-full justify-between`}
              >
                <SelectValue placeholder="Make to stock" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MAKE_TO_STOCK_VALUE}>Make to stock</SelectItem>
                {salesLineOptions.map((line) => (
                  <SelectItem key={line.salesOrderLineId} value={line.salesOrderLineId}>
                    {line.salesOrderNumber} · {line.customerName} ·{" "}
                    {formatQuantity(line.quantity)} {line.unitName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className={styles.readOnlyFieldValue} title={planningLockedReason ?? undefined}>
              {order?.salesOrderNumber
                ? `${order.salesOrderNumber}${order.salesCustomerName ? ` · ${order.salesCustomerName}` : ""}`
                : "Make to stock"}
            </div>
          )}
        </FormField>
      </div>
    </section>
  );
}

function productLabel(option: ManufacturingProductOption) {
  return option.displayName && option.displayName !== option.name
    ? `${option.displayName} (${option.name})`
    : option.name;
}

function resolvePlannedOutputQuantity({
  inputQuantity,
  manufacturingMode,
  expectedBatchYield,
}: {
  inputQuantity: string;
  manufacturingMode?: string | null;
  expectedBatchYield?: string | null;
}) {
  const quantity = Number(inputQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (manufacturingMode !== "batch") return formatDecimal(quantity);

  const batchCount = Math.round(quantity);
  if (Math.abs(quantity - batchCount) > 0.0001) return null;
  const batchYield = Number(expectedBatchYield);
  if (!Number.isFinite(batchYield) || batchYield <= 0) return null;
  return formatDecimal(batchCount * batchYield);
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
