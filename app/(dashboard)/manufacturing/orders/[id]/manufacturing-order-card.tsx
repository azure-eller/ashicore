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
  FixedEditableLines,
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import {
  formatDate,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import {
  fetchManufacturingSalesLineOptions,
  patchManufacturingOrderIngredient,
} from "@/lib/api/clients/manufacturing-orders";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import {
  isManufacturingStatusDisabled,
  manufacturingOrderStatusConfig,
} from "@/components/card-page/order-status-configs";
import {
  LotStrategyChip,
  type PickedLotSummary,
} from "@/components/manufacturing/lot-strategy-chip";
import { ManufacturingIngredientLotCard } from "@/components/manufacturing/ingredient-lot-card";
import { CardPage, CardPageBody, CardSection } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import {
  CellShell,
  DisabledFieldTooltip,
  underlineControlClass,
} from "@/components/card-page/form-cell";
import { CommitInput } from "@/components/card-page/commit-input";
import { NotesField } from "@/components/card-page/notes-field";
import { DetailHeaderTitle } from "@/components/card-page/detail-header-title";
import type { InventoryItemComboboxOption } from "@/components/inventory-item-combobox";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import type {
  ManufacturingOrderDetail,
  ManufacturingOrderIngredientDetail,
  ManufacturingOrderOperationCostDetail,
} from "@/app/(dashboard)/manufacturing/types";
import type { ManufacturingLotStrategy } from "@/lib/schemas/manufacturing-orders";
import styles from "@/components/card-page/card-page.module.css";
import {
  useManufacturingOrderDraftController,
  makeDraftIngredient,
  makeDraftManufacturingOrder,
  resolvePlannedOutputQuantity,
  type ManufacturingOrderDraftController,
} from "./use-manufacturing-order-draft-controller";

export type ManufacturingProductOption = {
  id: string;
  name: string;
  displayName?: string;
  sku: string | null;
  unitName: string;
  manufacturingMode: string;
  expectedBatchYield: string | null;
  bom: Array<{
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
    quantityPerUnit: string;
    defaultQuantityPerUnit: string;
  }>;
};

const MAKE_TO_STOCK_VALUE = "__make_to_stock__";

export function ManufacturingOrderCard({
  initialOrder,
  productOptions = [],
}: {
  initialOrderId: string | null;
  initialOrder: ManufacturingOrderDetail | null;
  productOptions?: ManufacturingProductOption[];
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [lotPickerIngredient, setLotPickerIngredient] =
    useState<ManufacturingOrderIngredientDetail | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const goBack = useSmartBack("/manufacturing/orders");
  const initialDraft = useMemo(() => makeDraftManufacturingOrder(), []);
  const controller = useManufacturingOrderDraftController({
    initialOrder,
    initialDraft,
    queryClient,
    onPersisted: (id) => {
      reflectPersistedCardUrlWithoutNavigation(`/manufacturing/order/${id}`);
    },
  });
  const order = controller.draft;
  const currentOrderId = controller.currentOrderId;
  const isDraft = !controller.hasPersistedOrder;

  const refreshOrder = useCallback(() => {
    void controller.refreshFromServer();
    if (currentOrderId != null) {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-order", currentOrderId] });
    }
  }, [controller, currentOrderId, queryClient]);

  const duplicateMutation = useMutation({
    mutationKey: ["mo-action", currentOrderId ?? "__draft__", "duplicate"],
    onMutate: () => setActionError(null),
    mutationFn: async () => {
      await controller.flush();
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
      router.push(`/manufacturing/order/${created.id}`);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const deleteMutation = useDeleteEntity({
    mutationKey: ["mo-action", currentOrderId ?? "__draft__", "delete"],
    onMutate: () => setActionError(null),
    mutationFn: async () => {
      await controller.flush();
      const response = await fetch(`/api/manufacturing-orders/${currentOrderId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete order.");
      }
    },
    invalidateQueryKeys: [["manufacturing-orders"]],
    onDeleted: goBack,
    onError: (error) => setActionError((error as Error).message),
  });
  const deleteConfirm = useConfirmMutation<void>({
    title: "Delete this order?",
    description: (
      <>
        Open orders are removed from normal views and reversible picked or
        reserved inventory is released. For batch orders with completed
        batches, completed output and consumed ingredients are kept as
        production history while remaining work is cancelled. This action
        cannot be undone.
      </>
    ),
    confirmLabel: "Delete Order",
    pendingLabel: "Deleting...",
    cancelLabel: "Back",
    mutation: deleteMutation,
  });
  const lotAllocationMutation = useMutation({
    mutationKey: ["mo-action", currentOrderId ?? "__draft__", "ingredient-lot-allocation"],
    onMutate: () => setActionError(null),
    mutationFn: async ({
      ingredientId,
      allocations,
    }: {
      ingredientId: string;
      allocations: Array<{ sourceId: string; quantity: string }>;
    }) => {
      await controller.flush();
      if (!currentOrderId) throw new Error("Save the manufacturing order before allocating lots.");
      return patchManufacturingOrderIngredient(currentOrderId, ingredientId, {
        lotStrategy: "custom",
        allocations,
      });
    },
    onSuccess: () => {
      void controller.refreshFromServer();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const editState = getManufacturingOrderEditState(order);
  const headerSaveState: CardSaveState =
    controller.status === "saving" || controller.status === "dirty"
      ? "saving"
      : controller.status === "error" || actionError
        ? "failed"
        : isDraft
          ? "not_saved"
          : "saved";
  const headerSaveMessage =
    controller.status === "error" ? controller.error : actionError;
  const ingredientOptions = useMemo(
    () => buildIngredientOptions(productOptions, order.ingredients),
    [order.ingredients, productOptions],
  );
  const handleClose = useCallback(() => {
    void controller.flush().then(goBack).catch((error) => {
      setActionError(error instanceof Error ? error.message : "Failed to save manufacturing order.");
    });
  }, [controller, goBack]);

  return (
    <CardPage>
      <CardPageHeader
        title={
          !isDraft ? (
            <DetailHeaderTitle
              recordNumber={order.orderNumber}
              name={order.productName}
              subId={order.productSku}
            />
          ) : (
            "New manufacturing order"
          )
        }
        statusControl={
          !isDraft ? (
            <OrderStatusControl
              config={manufacturingOrderStatusConfig}
              ctx={{
                order: {
                  id: order.id,
                  status: order.status,
                  isBlocked: order.isBlocked,
                  manufacturingMode: order.manufacturingMode,
                  pickProgressStatus: order.pickProgressStatus,
                  completedBatchCount: order.batches.filter(
                    (batch) => batch.status === "completed",
                  ).length,
                  actualQuantity: order.actualQuantity,
                },
              }}
              disabled={isManufacturingStatusDisabled(order)}
              onChanged={refreshOrder}
            />
          ) : null
        }
        saveState={headerSaveState}
        saveMessage={headerSaveMessage}
        showPrint={false}
        menuActions={
          !isDraft
            ? [
                {
                  label: "Duplicate",
                  onClick: () => duplicateMutation.mutate(),
                  disabled: duplicateMutation.isPending,
                },
                {
                  label: "Print",
                  onClick: () => window.print(),
                },
                {
                  label: "Delete order",
                  onClick: () => deleteConfirm.trigger(undefined),
                  destructive: true,
                },
              ]
            : []
        }
        onClose={handleClose}
        fallbackHref="/manufacturing/orders"
      />

      {actionError ? (
        <div className="px-(--space-5) py-(--space-3) bg-[var(--color-danger-soft)] text-destructive text-sm border-b border-[var(--color-line)]">
          {actionError}
        </div>
      ) : null}

      <CardPageBody>
        <OrderDetailsSection
          order={order}
          controller={controller}
          productOptions={productOptions}
          canEditMetadata={editState.canEditMetadata}
          canEditPlanning={editState.canEditPlanning}
          planningLockedReason={editState.planningLockedReason}
        />
        <IngredientsSection
          order={order}
          controller={controller}
          ingredientOptions={ingredientOptions}
          canEditPlanning={editState.canEditPlanning}
          planningLockedReason={editState.planningLockedReason}
          canEditLotAllocations={editState.canEditMetadata}
          metadataLockedReason={editState.metadataLockedReason}
          onOpenLotPicker={(ingredient) => setLotPickerIngredient(ingredient)}
        />
        <OperationsSection order={order} />
        <NotesSection
          order={order}
          controller={controller}
          canEdit={editState.canEditMetadata}
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

      {deleteConfirm.dialog}
    </CardPage>
  );
}

function OrderDetailsSection({
  order,
  controller,
  productOptions,
  canEditMetadata,
  canEditPlanning,
  planningLockedReason,
}: {
  order: ManufacturingOrderDetail;
  controller: ManufacturingOrderDraftController;
  productOptions: ManufacturingProductOption[];
  canEditMetadata: boolean;
  canEditPlanning: boolean;
  planningLockedReason: string | null;
}) {
  const unitName = order.unitName;
  const salesLineOptionsQuery = useQuery({
    queryKey: ["manufacturing-sales-line-options", order.productId || "__draft__"],
    queryFn: () => fetchManufacturingSalesLineOptions(order.productId),
    enabled: controller.hasPersistedOrder && order.productId !== "",
    staleTime: 60_000,
  });
  const salesLineOptions = salesLineOptionsQuery.data ?? [];

  const selectedProductId = order.productId;
  const selectedProduct = productOptions.find((option) => option.id === selectedProductId);
  const isBatchProduct =
    order.manufacturingMode === "batch" || selectedProduct?.manufacturingMode === "batch";
  const expectedBatchYield = order.expectedBatchYield ?? selectedProduct?.expectedBatchYield ?? null;
  const plannedInputValue =
    order.manufacturingMode === "batch" && order.numberOfBatches != null
      ? String(order.numberOfBatches)
      : order.requestedQuantity || order.plannedQuantity;
  const plannedFieldLabel = isBatchProduct ? "Batches" : "Planned quantity";
  const plannedFieldSuffix = isBatchProduct ? "batches" : unitName || "units";
  const productSelectDisabled = productOptions.length === 0;
  const productDisabledReason = productSelectDisabled
    ? "Create a product with a recipe before creating a manufacturing order."
    : null;
  const salesOrderDisabledReason = !controller.hasPersistedOrder
    ? "Select a product first to create the manufacturing order before linking sales demand."
    : salesLineOptionsQuery.isLoading
      ? "Loading matching sales order lines."
      : null;

  const handleProductChange = (productId: string) => {
    const product = productOptions.find((option) => option.id === productId);
    if (!product) return;
    if (productId === order.productId || !canEditPlanning) return;
    controller.selectProduct(product);
  };

  const handleSalesLineChange = (value: string) => {
    if (!controller.hasPersistedOrder || !canEditPlanning) return;
    if (value === MAKE_TO_STOCK_VALUE) {
      if (!order.salesOrderId && !order.salesOrderLineId) return;
      controller.patchHeader({
        salesOrderId: null,
        salesOrderLineId: null,
        salesOrderNumber: null,
        salesCustomerName: null,
      });
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
    controller.patchHeader({
      plannedDate: line.shipDate ?? order.plannedDate,
      salesOrderId: line.salesOrderId,
      salesOrderLineId: line.salesOrderLineId,
      salesOrderNumber: line.salesOrderNumber,
      salesCustomerName: line.customerName,
    });
    controller.updatePlannedInput(
      order.manufacturingMode === "batch"
        ? String(Math.ceil(Number(line.quantity) / Number(order.expectedBatchYield)))
        : plannedQuantity,
    );
  };

  return (
    <CardSection title="Order details">
      <div className={styles.formRow}>
        <CellShell label="Product" required invalid={canEditPlanning && !order.productId}>
          {canEditPlanning ? (
            <DisabledFieldTooltip reason={productDisabledReason}>
              <Select
                value={selectedProductId}
                onValueChange={handleProductChange}
                disabled={productSelectDisabled}
              >
                <SelectTrigger
                  aria-label="Product"
                  aria-invalid={canEditPlanning && !order.productId}
                  className={underlineControlClass(
                    canEditPlanning && !order.productId,
                    "w-full justify-between",
                  )}
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
            </DisabledFieldTooltip>
          ) : (
            <div className={styles.readOnlyFieldValue} title={planningLockedReason ?? undefined}>
              {order.productName || "Select product"}
            </div>
          )}
        </CellShell>
        <CellShell label="Production deadline">
          {canEditMetadata ? (
            <DatePicker
              aria-label="Planned date"
              value={order.plannedDate ?? ""}
              className={underlineControlClass()}
              onChange={(next) => {
                const normalized = next || null;
                if (normalized !== order.plannedDate) {
                  controller.patchHeader({ plannedDate: normalized });
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
        </CellShell>
        <CellShell label="Manufacturing location">
          <div className={styles.readOnlyFieldValue}>Default location</div>
        </CellShell>
      </div>
      <div className={styles.formRow}>
        <CellShell label={plannedFieldLabel}>
          {canEditPlanning ? (
            <div className={styles.suffixField}>
              <CommitInput
                label={plannedFieldLabel}
                value={plannedInputValue}
                inputMode={isBatchProduct ? "numeric" : "decimal"}
                className={`${styles.underlineInput} ${styles.mono} text-right`}
                onDraftChange={(next) => controller.updatePlannedInput(next)}
                onCommit={(next) => {
                  if (!next) return;
                  if (next !== plannedInputValue) {
                    controller.updatePlannedInput(next);
                  }
                }}
              />
              <span className={styles.fieldSuffix}>{plannedFieldSuffix}</span>
            </div>
          ) : (
            <div
              className={`${styles.suffixField} ${styles.suffixFieldReadOnly}`}
              title={planningLockedReason ?? undefined}
            >
              <span className={`${styles.underlineInput} ${styles.mono} text-right`}>
                {formatQuantity(plannedInputValue)}
              </span>
              <span className={styles.fieldSuffix}>{plannedFieldSuffix}</span>
            </div>
          )}
        </CellShell>
        <CellShell label="Batch yield">
          <div className={`${styles.suffixField} ${styles.suffixFieldReadOnly}`}>
            <span className={`${styles.underlineInput} ${styles.mono} text-right`}>
              {expectedBatchYield != null ? formatQuantity(expectedBatchYield) : "—"}
            </span>
            <span className={styles.fieldSuffix}>{unitName || selectedProduct?.unitName || "—"}</span>
          </div>
        </CellShell>
        <CellShell label="Sales order">
          {canEditPlanning ? (
            <DisabledFieldTooltip reason={salesOrderDisabledReason}>
              <Select
                value={order.salesOrderLineId ?? MAKE_TO_STOCK_VALUE}
                onValueChange={handleSalesLineChange}
                disabled={salesOrderDisabledReason != null}
              >
                <SelectTrigger
                  aria-label="Sales order"
                  className={underlineControlClass(false, "w-full justify-between")}
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
            </DisabledFieldTooltip>
          ) : (
            <div className={styles.readOnlyFieldValue} title={planningLockedReason ?? undefined}>
              {order?.salesOrderNumber
                ? `${order.salesOrderNumber}${order.salesCustomerName ? ` · ${order.salesCustomerName}` : ""}`
                : "Make to stock"}
            </div>
          )}
        </CellShell>
      </div>
    </CardSection>
  );
}

function productLabel(option: ManufacturingProductOption) {
  return option.displayName && option.displayName !== option.name
    ? `${option.displayName} (${option.name})`
    : option.name;
}

function buildIngredientOptions(
  productOptions: ManufacturingProductOption[],
  currentIngredients: ManufacturingOrderIngredientDetail[],
): InventoryItemComboboxOption[] {
  const byId = new Map<string, InventoryItemComboboxOption>();
  for (const ingredient of currentIngredients) {
    if (!ingredient.itemId) continue;
    byId.set(ingredient.itemId, {
      id: ingredient.itemId,
      name: ingredient.itemName,
      displayName: ingredient.itemName,
      sku: ingredient.itemSku,
      itemType: ingredient.itemType,
      unitName: ingredient.unitName,
    });
  }
  for (const product of productOptions) {
    for (const ingredient of product.bom) {
      byId.set(ingredient.itemId, {
        id: ingredient.itemId,
        name: ingredient.itemName,
        displayName: ingredient.itemName,
        sku: ingredient.itemSku,
        itemType: ingredient.itemType,
        unitName: ingredient.unitName,
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name),
  );
}

function ingredientFromOption(
  option: InventoryItemComboboxOption,
  plannedQuantity: string,
  values?: { id?: string; quantityPerUnit?: string; sortOrder?: number },
) {
  const ingredient = makeDraftIngredient(
    {
      itemId: option.id,
      itemName: option.displayName ?? option.name,
      itemSku: option.sku ?? null,
      itemType: option.itemType ?? "material",
      unitName: option.unitName ?? "",
      quantityPerUnit: values?.quantityPerUnit ?? "1",
    },
    plannedQuantity,
    values?.sortOrder ?? 0,
  );
  return values?.id ? { ...ingredient, id: values.id } : ingredient;
}

function makeBlankIngredient(plannedQuantity: string, sortOrder: number) {
  return {
    ...makeDraftIngredient(
      {
        itemId: "",
        itemName: "",
        itemSku: null,
        itemType: "material",
        unitName: "",
        quantityPerUnit: "1",
      },
      plannedQuantity,
      sortOrder,
    ),
    itemId: "",
    itemName: "",
  };
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

function IngredientsSection({
  order,
  controller,
  ingredientOptions,
  canEditPlanning,
  planningLockedReason,
  canEditLotAllocations,
  metadataLockedReason,
  onOpenLotPicker,
}: {
  order: ManufacturingOrderDetail;
  controller: ManufacturingOrderDraftController;
  ingredientOptions: InventoryItemComboboxOption[];
  canEditPlanning: boolean;
  planningLockedReason: string | null;
  canEditLotAllocations: boolean;
  metadataLockedReason: string | null;
  onOpenLotPicker: (ingredient: ManufacturingOrderIngredientDetail) => void;
}) {
  const [confirmDelete, setConfirmDelete] =
    useState<ManufacturingOrderIngredientDetail | null>(null);

  const ingredients = useMemo(() => order.ingredients ?? [], [order.ingredients]);
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
  const optionMap = useMemo(
    () => new Map(ingredientOptions.map((option) => [option.id, option])),
    [ingredientOptions],
  );

  const handleRowsChange = useCallback(
    (
      next: ManufacturingOrderIngredientDetail[],
      change: EditableLineDataGridChange<ManufacturingOrderIngredientDetail>,
    ) => {
      setRows(next);
      if (change.type === "row_reordered") {
        controller.reorderIngredients(next.map((row) => row.id));
        return;
      }
      if (change.type === "row_added" && change.row) {
        return;
      }
      if (change.type === "cell_edit_committed" && change.row && change.field) {
        if (change.field === "itemId") {
          const option = optionMap.get(change.row.itemId);
          if (!option) return;
          const nextIngredient = ingredientFromOption(option, order.plannedQuantity, {
            id: change.row.id,
            quantityPerUnit: change.row.quantityPerUnit || "1",
            sortOrder: change.row.sortOrder,
          });
          if (change.row.id.startsWith("draft-") && !ingredients.some((row) => row.id === change.row?.id)) {
            controller.addIngredient(nextIngredient);
          } else {
            controller.updateIngredient(change.row.id, nextIngredient);
          }
          return;
        }
        if (change.field === "quantityPerUnit") {
          if (!change.row.itemId) return;
          if (change.row.id.startsWith("draft-") && !ingredients.some((row) => row.id === change.row?.id)) {
            const option = optionMap.get(change.row.itemId);
            if (!option) return;
            controller.addIngredient(
              ingredientFromOption(option, order.plannedQuantity, {
                id: change.row.id,
                quantityPerUnit: change.row.quantityPerUnit,
                sortOrder: change.row.sortOrder,
              }),
            );
          } else {
            controller.updateIngredient(change.row.id, {
              quantityPerUnit: change.row.quantityPerUnit,
            });
          }
        }
      }
    },
    [controller, ingredients, optionMap, order.plannedQuantity],
  );

  const columns = useMemo<LineField<ManufacturingOrderIngredientDetail>[]>(
    () => [
      {
        field: "itemId",
        headerName: "Ingredient",
        flex: 1.5,
        minWidth: 220,
        editable: (row) => canEditPlanning && row?.pickStatus === "not_picked",
        kind: "inventory-item",
        options: ingredientOptions,
        placeholder: "Search ingredients...",
        emptyMessage: "No ingredients found",
        requiredMessage: "Ingredient is required",
        createLinks: [
          { href: "/inventory/product", label: "Create product" },
          { href: "/inventory/material", label: "Create material" },
        ],
        getSecondaryText: (option) =>
          [option.sku, option.itemType, option.unitName]
            .filter((part): part is string => part != null && part !== "")
            .join(" · "),
        valueSetter: (params) => {
          const option = optionMap.get(String(params.newValue ?? ""));
          if (!option) return false;
          Object.assign(
            params.data,
            ingredientFromOption(option, order.plannedQuantity, {
              id: params.data.id,
              quantityPerUnit: params.data.quantityPerUnit || "1",
              sortOrder: params.data.sortOrder,
            }),
          );
          return true;
        },
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
        field: "quantityPerUnit",
        headerName: "Per unit",
        kind: "number",
        rightAligned: true,
        width: 120,
        mono: true,
        editable: (row) => canEditPlanning && Boolean(row?.itemId) && row?.pickStatus === "not_picked",
        valueFormatter: ({ value }) => formatQuantity(String(value ?? "0")) ?? "0",
        valueSetter: (params) => {
          const parsed = Number.parseFloat(String(params.newValue).trim());
          if (!Number.isFinite(parsed) || parsed <= 0) return false;
          const normalized = parsed.toString();
          if (normalized === Number.parseFloat(params.data.quantityPerUnit).toString()) {
            return false;
          }
          params.data.quantityPerUnit = normalized;
          params.data.plannedQuantity = (parsed * Number(order.plannedQuantity || 0)).toString();
          return true;
        },
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
          if (!params.data || !controller.hasPersistedOrder) return null;
          const ingredient = params.data;
          const picked = Number(ingredient.pickedQuantity);
          const canEditIngredientLots =
            canEditLotAllocations &&
            ingredient.pickStatus === "not_picked" &&
            !ingredient.id.startsWith("draft-") &&
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
    [
      canEditLotAllocations,
      canEditPlanning,
      controller.hasPersistedOrder,
      ingredientOptions,
      metadataLockedReason,
      onOpenLotPicker,
      optionMap,
      order.id,
      order.plannedQuantity,
    ],
  );

  return (
    <CardSection
      title="Ingredients"
      count={`· ${ingredients.length} item${ingredients.length === 1 ? "" : "s"}${
        materialCost > 0 ? ` · ${formatPrice(String(materialCost))} material cost` : ""
      }`}
    >
      <MutableLines<ManufacturingOrderIngredientDetail>
        rows={rows}
        fields={columns}
        getRowId={(row) => row.id}
        createRow={() => makeBlankIngredient(order.plannedQuantity, rows.length)}
        onRowsChange={handleRowsChange}
        addLabel="Add ingredient"
        readOnly={!canEditPlanning}
        emptyMessage={
          order.productId
            ? "No ingredients yet."
            : "No ingredients yet. Pick a product to populate the bill of materials."
        }
        canDeleteRow={() => canEditPlanning}
        getDeleteDisabledReason={() => (!canEditPlanning ? planningLockedReason : null)}
        onDeleteRow={(row) => setConfirmDelete(row)}
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
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!confirmDelete) return;
                controller.removeIngredient(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardSection>
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

  const columns = useMemo<LineField<ManufacturingOrderOperationCostDetail>[]>(
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
    <CardSection
      title="Operations"
      count={`· ${operations.length} step${operations.length === 1 ? "" : "s"}`}
    >
      <FixedEditableLines<ManufacturingOrderOperationCostDetail>
        rows={rows}
        fields={columns}
        getRowId={(row) => row.id}
        createRow={() => rows[0]!}
        onRowsChange={setRows}
        emptyMessage="No operations for this product."
      />
    </CardSection>
  );
}

function NotesSection({
  order,
  controller,
  canEdit,
}: {
  order: ManufacturingOrderDetail;
  controller: ManufacturingOrderDraftController;
  canEdit: boolean;
}) {
  return (
    <CardSection title="Notes" hint="internal only">
      <NotesField
        value={order.notes ?? ""}
        disabled={!canEdit}
        readOnlyValue={!canEdit}
        rows={3}
        className="min-h-20"
        readOnlyClassName="min-h-20 bg-[var(--color-surface-alt)] text-[13px] text-[var(--color-ink)]"
        placeholder="Notes for this order…"
        onCommit={(next) => {
          if (next !== order.notes) controller.patchHeader({ notes: next });
        }}
      />
    </CardSection>
  );
}
