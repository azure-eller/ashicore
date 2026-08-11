"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  FixedEditableLines,
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatDate,
  formatPrice,
  formatQuantity,
  normalizeNumeric,
} from "@/lib/format";
import { CardSection } from "@/components/card-page/card-page";
import { CardField } from "@/components/card-page/card-field";
import {
  CardFormRow,
  DisabledFieldTooltip,
  ReadOnlyFieldValue,
  underlineControlClass,
} from "@/components/card-page/form-cell";
import { CommitInput } from "@/components/card-page/commit-input";
import { NotesField } from "@/components/card-page/notes-field";
import type { InventoryItemComboboxOption } from "@/components/inventory-item-combobox";
import type {
  ManufacturingOrderDetail,
  ManufacturingOrderIngredientDetail,
  ManufacturingOrderOperationCostDetail,
} from "@/lib/manufacturing/types";
import styles from "@/components/card-page/card-page.module.css";
import {
  ingredientRequirementMultiplier,
  makeDraftIngredient,
  multiplyQuantityString,
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
    siblingVariants: ManufacturingOrderIngredientDetail["siblingVariants"];
    alternates: Array<{
      itemId: string;
      itemName: string;
      itemSku: string | null;
      itemType: string;
      unitName: string;
      quantity: string | null;
      quantityFactor: string | null;
      sortOrder: number;
    }>;
  }>;
};

export type ManufacturingIngredientOption = InventoryItemComboboxOption & {
  quantityPerUnit?: string;
};

export function OrderDetailsSection({
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
  const hasLinkedSalesOrder = Boolean(order.salesOrderId && order.salesOrderLineId);

  const selectedProductId = order.productId;
  const selectedProduct = productOptions.find((option) => option.id === selectedProductId);
  const isBatchProduct =
    order.manufacturingMode === "batch" || selectedProduct?.manufacturingMode === "batch";
  const plannedInputValue =
    order.manufacturingMode === "batch" && order.numberOfBatches != null
      ? String(order.numberOfBatches)
      : order.requestedQuantity || order.plannedQuantity;
  const plannedFieldLabel = isBatchProduct ? "Number of batches" : "Quantity";
  const plannedFieldSuffix = isBatchProduct ? "batches" : unitName || "units";
  const outputUnitName = unitName || selectedProduct?.unitName || "units";
  const productSelectDisabled = productOptions.length === 0;
  const productDisabledReason = productSelectDisabled
    ? "Create a product with a recipe before creating a manufacturing order."
    : null;
  const salesOrderReadOnlyReason = hasLinkedSalesOrder
    ? "Linked make-to-order manufacturing orders keep their sales order link."
    : planningLockedReason;

  const handleProductChange = (productId: string) => {
    const product = productOptions.find((option) => option.id === productId);
    if (!product) return;
    if (productId === order.productId || !canEditPlanning) return;
    controller.selectProduct(product);
  };

  return (
    <CardSection title="Order details">
      <CardFormRow>
        <CardField
          label="Product"
          htmlFor="manufacturing-order-product"
          required
          invalid={canEditPlanning && !order.productId}
        >
          {canEditPlanning ? (
            <DisabledFieldTooltip reason={productDisabledReason}>
              <Select
                value={selectedProductId}
                onValueChange={handleProductChange}
                disabled={productSelectDisabled}
              >
                <SelectTrigger
                  id="manufacturing-order-product"
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
            <ReadOnlyFieldValue title={planningLockedReason ?? undefined}>
              {order.productName || "Select product"}
            </ReadOnlyFieldValue>
          )}
        </CardField>
        <CardField label="Production deadline" htmlFor="manufacturing-order-planned-date">
          {canEditMetadata ? (
            <DatePicker
              id="manufacturing-order-planned-date"
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
            <ReadOnlyFieldValue mono title="Completed manufacturing orders are historical records.">
              {order?.plannedDate ? formatDate(order.plannedDate) : "—"}
            </ReadOnlyFieldValue>
          )}
        </CardField>
        <CardField label="Manufacturing location">
          <ReadOnlyFieldValue>Default location</ReadOnlyFieldValue>
        </CardField>
      </CardFormRow>
      <CardFormRow>
        <CardField
          label={plannedFieldLabel}
          htmlFor={canEditPlanning ? "manufacturing-order-planned-input" : undefined}
        >
          {canEditPlanning ? (
            <>
              <div className={styles.suffixField}>
                {isBatchProduct ? (
                  <BatchCountInput
                    id="manufacturing-order-planned-input"
                    label={plannedFieldLabel}
                    value={plannedInputValue}
                    onChange={controller.updatePlannedInput}
                  />
                ) : (
                  <CommitInput
                    id="manufacturing-order-planned-input"
                    label={plannedFieldLabel}
                    value={plannedInputValue}
                    inputMode="decimal"
                    className={`${styles.underlineInput} ${styles.mono} text-right`}
                    onDraftChange={(next) => controller.updatePlannedInput(next)}
                    onCommit={(next) => {
                      if (!next) return;
                      if (next !== plannedInputValue) {
                        controller.updatePlannedInput(next);
                      }
                    }}
                  />
                )}
                <span className={styles.fieldSuffix}>{plannedFieldSuffix}</span>
              </div>
            </>
          ) : (
            <>
              <div
                className={`${styles.suffixField} ${styles.suffixFieldReadOnly}`}
                title={planningLockedReason ?? undefined}
              >
                <span className={`${styles.underlineInput} ${styles.mono} text-right`}>
                  {formatQuantity(plannedInputValue)}
                </span>
                <span className={styles.fieldSuffix}>{plannedFieldSuffix}</span>
              </div>
            </>
          )}
        </CardField>
        {isBatchProduct ? (
          <CardField
            label="Expected output"
            htmlFor={canEditPlanning ? "manufacturing-order-planned-output" : undefined}
          >
            {canEditPlanning ? (
              <div className={styles.suffixField}>
                <CommitInput
                  id="manufacturing-order-planned-output"
                  label="Expected output"
                  value={order.plannedQuantity}
                  inputMode="decimal"
                  className={`${styles.underlineInput} ${styles.mono} text-right`}
                  onDraftChange={(next) => controller.updatePlannedOutput(next)}
                  onCommit={(next) => {
                    if (!next) return;
                    if (next !== order.plannedQuantity) {
                      controller.updatePlannedOutput(next);
                    }
                  }}
                />
                <span className={styles.fieldSuffix}>{outputUnitName}</span>
              </div>
            ) : (
              <div
                className={`${styles.suffixField} ${styles.suffixFieldReadOnly}`}
                title={planningLockedReason ?? undefined}
              >
                <span className={`${styles.underlineInput} ${styles.mono} text-right`}>
                  {formatQuantity(order.plannedQuantity)}
                </span>
                <span className={styles.fieldSuffix}>{outputUnitName}</span>
              </div>
            )}
          </CardField>
        ) : null}
        {hasLinkedSalesOrder ? (
          <CardField label="Sales order">
            <ReadOnlyFieldValue title={salesOrderReadOnlyReason ?? undefined}>
              {`${order.salesOrderNumber}${order.salesCustomerName ? ` · ${order.salesCustomerName}` : ""}`}
            </ReadOnlyFieldValue>
          </CardField>
        ) : null}
      </CardFormRow>
    </CardSection>
  );
}


function productLabel(option: ManufacturingProductOption) {
  return option.displayName || option.name;
}

function addIngredientAndSiblingOptions(
  byId: Map<string, ManufacturingIngredientOption>,
  ingredient: {
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
    quantityPerUnit: string;
    siblingVariants: ManufacturingOrderIngredientDetail["siblingVariants"];
  }
) {
  if (!ingredient.itemId) return;
  byId.set(ingredient.itemId, {
    id: ingredient.itemId,
    name: ingredient.itemName,
    displayName: ingredient.itemName,
    sku: ingredient.itemSku,
    itemType: ingredient.itemType,
    unitName: ingredient.unitName,
    quantityPerUnit: ingredient.quantityPerUnit,
  });

  for (const sibling of ingredient.siblingVariants) {
    byId.set(sibling.itemId, {
      id: sibling.itemId,
      name: sibling.itemName,
      displayName: sibling.itemName,
      sku: sibling.itemSku,
      itemType: sibling.itemType,
      unitName: sibling.unitName,
      quantityPerUnit: ingredient.quantityPerUnit,
    });
  }
}

export function buildIngredientOptions(
  productOptions: ManufacturingProductOption[],
  currentIngredients: ManufacturingOrderIngredientDetail[],
): ManufacturingIngredientOption[] {
  const byId = new Map<string, ManufacturingIngredientOption>();
  for (const ingredient of currentIngredients) {
    addIngredientAndSiblingOptions(byId, ingredient);
  }
  for (const product of productOptions) {
    for (const ingredient of product.bom) {
      addIngredientAndSiblingOptions(byId, ingredient);
    }
  }
  return [...byId.values()].sort((a, b) =>
    (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name),
  );
}

function ingredientFromOption(
  option: ManufacturingIngredientOption,
  requirementMultiplier: string,
  values?: { id?: string; quantityPerUnit?: string; sortOrder?: number },
) {
  const ingredient = makeDraftIngredient(
    {
      itemId: option.id,
      itemName: option.displayName ?? option.name,
      itemSku: option.sku ?? null,
      itemType: option.itemType ?? "material",
      unitName: option.unitName ?? "",
      quantityPerUnit: values?.quantityPerUnit ?? option.quantityPerUnit ?? "1",
      siblingVariants: [],
      alternates: [],
    },
    requirementMultiplier,
    values?.sortOrder ?? 0,
  );
  return values?.id ? { ...ingredient, id: values.id } : ingredient;
}

function makeBlankIngredient(requirementMultiplier: string, sortOrder: number) {
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
      requirementMultiplier,
      sortOrder,
    ),
    itemId: "",
    itemName: "",
  };
}

function mergeUnsentBlankIngredients(
  incoming: ManufacturingOrderIngredientDetail[],
  current: ManufacturingOrderIngredientDetail[],
) {
  const incomingIds = new Set(incoming.map((ingredient) => ingredient.id));
  const unsentBlankRows = current.filter(
    (ingredient) =>
      ingredient.id.startsWith("draft-") &&
      !ingredient.itemId &&
      !incomingIds.has(ingredient.id),
  );
  return unsentBlankRows.length > 0 ? [...incoming, ...unsentBlankRows] : incoming;
}

function BatchCountInput({
  id,
  label,
  value,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const normalizedValue = normalizeBatchCountInput(value) || "1";
  const [draft, setDraft] = useState(normalizedValue);

  useEffect(() => {
    setDraft(normalizedValue);
  }, [normalizedValue]);

  return (
    <Input
      id={id}
      aria-label={label}
      inputMode="numeric"
      value={draft}
      className={`${styles.underlineInput} ${styles.mono} text-right`}
      onChange={(event) => {
        const next = event.target.value.trim();
        if (next !== "" && !/^\d+$/.test(next)) return;
        setDraft(next);
        if (next !== "" && Number(next) > 0) {
          onChange(next);
        }
      }}
      onBlur={() => {
        if (draft === "" || Number(draft) <= 0) {
          setDraft(normalizedValue);
        }
      }}
    />
  );
}

function normalizeBatchCountInput(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(Math.max(1, Math.round(parsed)));
}

export function getManufacturingOrderEditState(order: ManufacturingOrderDetail | null) {
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

  if (order.startedAt != null) {
    return "Manufacturing work has started, so planning fields are locked to preserve execution history.";
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

function inventoryItemHref(ingredient: ManufacturingOrderIngredientDetail) {
  return ingredient.itemType === "material"
    ? `/inventory/materials/${ingredient.itemId}`
    : `/inventory/products/${ingredient.itemId}`;
}

function ingredientSelectionOptions(ingredient: ManufacturingOrderIngredientDetail) {
  const options = new Map<
    string,
    { itemId: string; itemName: string; label: string }
  >();

  const defaultItemId = ingredient.defaultItemId ?? ingredient.itemId;
  options.set(defaultItemId, {
    itemId: defaultItemId,
    itemName: ingredient.defaultItemName ?? ingredient.itemName,
    label: "Default",
  });

  for (const alternate of ingredient.alternates) {
    options.set(alternate.itemId, {
      itemId: alternate.itemId,
      itemName: alternate.itemName,
      label: "Variant",
    });
  }

  if (!options.has(ingredient.itemId)) {
    options.set(ingredient.itemId, {
      itemId: ingredient.itemId,
      itemName: ingredient.itemName,
      label: "Current",
    });
  }

  return [...options.values()];
}


export function IngredientsSection({
  order,
  controller,
  ingredientOptions,
  canEditPlanning,
  planningLockedReason,
}: {
  order: ManufacturingOrderDetail;
  controller: ManufacturingOrderDraftController;
  ingredientOptions: ManufacturingIngredientOption[];
  canEditPlanning: boolean;
  planningLockedReason: string | null;
}) {
  const [confirmDelete, setConfirmDelete] =
    useState<ManufacturingOrderIngredientDetail | null>(null);
  const [swappingIngredientId, setSwappingIngredientId] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  const ingredients = useMemo(() => order.ingredients ?? [], [order.ingredients]);
  const isBatchMode = order.manufacturingMode === "batch";
  const batchCount = isBatchMode ? Math.max(1, order.numberOfBatches ?? 1) : 1;
  const plannedOutputQuantity = Math.max(0, Number(order.plannedQuantity || 0));
  const requirementMultiplier = ingredientRequirementMultiplier(order);
  const batchYield =
    isBatchMode && batchCount > 0 ? plannedOutputQuantity / batchCount : plannedOutputQuantity;
  const quantityBasisHeader = isBatchMode ? "Per batch" : "Per unit";
  const quantityBasisValue = useCallback(
    (ingredient: ManufacturingOrderIngredientDetail) => {
      if (!isBatchMode) return ingredient.quantityPerUnit;
      return normalizeNumeric(Number(ingredient.plannedQuantity || 0) / batchCount);
    },
    [batchCount, isBatchMode],
  );
  const quantityPerUnitFromBasis = useCallback(
    (basisQuantity: number) => {
      if (!isBatchMode) return normalizeNumeric(basisQuantity);
      return normalizeNumeric(batchYield > 0 ? basisQuantity / batchYield : basisQuantity);
    },
    [batchYield, isBatchMode],
  );
  const [rows, setRows] = useState<ManufacturingOrderIngredientDetail[]>(ingredients);
  const [lastSynced, setLastSynced] = useState(ingredients);
  if (lastSynced !== ingredients) {
    setLastSynced(ingredients);
    setRows((current) => mergeUnsentBlankIngredients(ingredients, current));
  }

  const materialCost = ingredients.reduce((total, ingredient) => {
    const cost = Number(ingredient.actualCostTotal ?? 0);
    return Number.isFinite(cost) ? total + cost : total;
  }, 0);
  const optionMap = useMemo(
    () => new Map(ingredientOptions.map((option) => [option.id, option])),
    [ingredientOptions],
  );
  const getSiblingIngredientSelection = useCallback(
    (row: ManufacturingOrderIngredientDetail, itemId: string) => {
      if (itemId === row.defaultItemId) {
        return {
          itemId: row.defaultItemId,
          itemName: row.defaultItemName ?? row.itemName,
          itemSku: row.defaultItemSku,
          itemType: row.itemType,
          unitName: row.defaultUnitName ?? row.unitName,
        };
      }

      const alternate = row.alternates.find((candidate) => candidate.itemId === itemId);
      if (!alternate) return null;
      return {
        itemId: alternate.itemId,
        itemName: alternate.itemName,
        itemSku: alternate.itemSku,
        itemType: alternate.itemType,
        unitName: alternate.unitName,
      };
    },
    [],
  );
  const applySiblingIngredientSelection = useCallback(
    (row: ManufacturingOrderIngredientDetail, itemId: string) => {
      if (itemId === row.itemId) return;
      const selected = getSiblingIngredientSelection(row, itemId);
      if (!selected) return;

      controller.updateIngredient(row.id, {
        itemId: selected.itemId,
        itemName: selected.itemName,
        itemSku: selected.itemSku,
        itemType: selected.itemType,
        unitName: selected.unitName,
        plannedQuantity: multiplyQuantityString(row.quantityPerUnit, requirementMultiplier),
      });
    },
    [controller, getSiblingIngredientSelection, requirementMultiplier],
  );
  const swapExecutionIngredient = useCallback(
    async (row: ManufacturingOrderIngredientDetail, itemId: string) => {
      if (itemId === row.itemId) return;
      setSwappingIngredientId(row.id);
      setSwapError(null);
      try {
        await controller.runExternalMutation(async () => {
          const response = await fetch(
            `/api/manufacturing-orders/${order.id}/ingredients/${row.id}/material`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId }),
            },
          );
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? "Could not change the ingredient material.");
          }
          const refreshed = await fetch(`/api/manufacturing-orders/${order.id}`);
          if (!refreshed.ok) {
            throw new Error("Could not reload the manufacturing order.");
          }
          return (await refreshed.json()) as ManufacturingOrderDetail;
        });
      } catch (error) {
        setSwapError((error as Error).message);
      } finally {
        setSwappingIngredientId(null);
      }
    },
    [controller, order.id],
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
          const selected = getSiblingIngredientSelection(change.row, change.row.itemId);
          const option = optionMap.get(change.row.itemId);
          if (!selected && !option) return;
          if (!selected && change.row.defaultItemId) return;
          const nextIngredient = selected
            ? {
                ...change.row,
                itemId: selected.itemId,
                itemName: selected.itemName,
                itemSku: selected.itemSku,
                itemType: selected.itemType,
                unitName: selected.unitName,
                plannedQuantity: multiplyQuantityString(
                  change.row.quantityPerUnit,
                  requirementMultiplier,
                ),
              }
            : ingredientFromOption(option!, requirementMultiplier, {
                id: change.row.id,
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
          const quantityPerUnit = quantityPerUnitFromBasis(
            Number.parseFloat(change.row.quantityPerUnit)
          );
          if (change.row.id.startsWith("draft-") && !ingredients.some((row) => row.id === change.row?.id)) {
            const option = optionMap.get(change.row.itemId);
            if (!option) return;
            controller.addIngredient(
              ingredientFromOption(option, requirementMultiplier, {
                id: change.row.id,
                quantityPerUnit,
                sortOrder: change.row.sortOrder,
              }),
            );
          } else {
            controller.updateIngredient(change.row.id, {
              quantityPerUnit,
            });
          }
        }
      }
    },
    [
      controller,
      getSiblingIngredientSelection,
      ingredients,
      optionMap,
      quantityPerUnitFromBasis,
      requirementMultiplier,
    ],
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
        getSecondaryText: (option) => {
          const ingredientOption = option as ManufacturingIngredientOption;
          return [
            ingredientOption.sku,
            ingredientOption.itemType,
            ingredientOption.unitName,
          ]
            .filter((part): part is string => part != null && part !== "")
            .join(" · ");
        },
        valueSetter: (params) => {
          const itemId = String(params.newValue ?? "");
          const selected = getSiblingIngredientSelection(params.data, itemId);
          const option = optionMap.get(itemId);
          if (!selected && !option) return false;
          if (!selected && params.data.defaultItemId) return false;
          if (selected) {
            Object.assign(params.data, {
              itemId: selected.itemId,
              itemName: selected.itemName,
              itemSku: selected.itemSku,
              itemType: selected.itemType,
              unitName: selected.unitName,
              plannedQuantity: multiplyQuantityString(
                params.data.quantityPerUnit,
                requirementMultiplier,
              ),
            });
          } else {
            Object.assign(
              params.data,
              ingredientFromOption(option!, requirementMultiplier, {
                id: params.data.id,
                sortOrder: params.data.sortOrder,
              }),
            );
          }
          return true;
        },
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          if (!params.data) return null;
          const sub = [params.data.itemType, params.data.unitName].filter(Boolean).join(" · ");
          const siblingOptions = ingredientSelectionOptions(params.data);
          const canSelectSibling =
            siblingOptions.length > 1 &&
            params.data.pickStatus === "not_picked";
          return (
            <div className="flex min-w-0 items-start gap-(--space-2) leading-tight">
              {canSelectSibling ? (
                <div
                  className="mt-(--space-1) flex shrink-0"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <Select
                    value={params.data.itemId}
                    disabled={swappingIngredientId === params.data.id}
                    onValueChange={(itemId) => {
                      if (!params.data) return;
                      if (canEditPlanning) {
                        applySiblingIngredientSelection(params.data, itemId);
                      } else {
                        void swapExecutionIngredient(params.data, itemId);
                      }
                    }}
                  >
                    <SelectTrigger
                      aria-label={`Choose variant for ${params.data.itemName}`}
                      className="!h-(--space-8) !w-(--space-8) !gap-0 !border-0 !bg-transparent !p-0 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                    />
                    <SelectContent align="start">
                      {siblingOptions.map((option) => (
                        <SelectItem key={option.itemId} value={option.itemId}>
                          <div className="flex flex-col">
                            <span>{option.itemName}</span>
                            <span className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                              {option.label}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="flex min-w-0 flex-col">
                <Link
                  href={inventoryItemHref(params.data)}
                  className="truncate text-[length:var(--text-md)] font-medium text-[var(--color-ink)] hover:text-[var(--color-accent-ink)] hover:underline"
                >
                  {params.data.itemName}
                </Link>
              {sub ? (
                <span className="text-[length:var(--text-sm)] text-[var(--color-muted)] capitalize">{sub}</span>
              ) : null}
              </div>
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
        headerName: quantityBasisHeader,
        kind: "number",
        rightAligned: true,
        width: 120,
        mono: true,
        editable: (row) => canEditPlanning && Boolean(row?.itemId) && row?.pickStatus === "not_picked",
        valueGetter: ({ data }) => (data ? quantityBasisValue(data) : "0"),
        valueFormatter: ({ value }) => formatQuantity(String(value ?? "0")) ?? "0",
        valueSetter: (params) => {
          const parsed = Number.parseFloat(String(params.newValue).trim());
          if (!Number.isFinite(parsed) || parsed <= 0) return false;
          const quantityPerUnit = quantityPerUnitFromBasis(parsed);
          if (quantityPerUnit === Number.parseFloat(params.data.quantityPerUnit).toString()) {
            return false;
          }
          params.data.quantityPerUnit = quantityPerUnit;
          params.data.plannedQuantity = isBatchMode
            ? normalizeNumeric(parsed * batchCount)
            : normalizeNumeric(parsed * plannedOutputQuantity);
          return true;
        },
      },
      {
        field: "plannedQuantity",
        headerName: "Total",
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
        field: "actualCostTotal",
        headerName: "Cost",
        type: "rightAligned",
        width: 110,
        cellClass: styles.mono,
        valueFormatter: ({ value }) => (value != null ? (formatPrice(String(value)) ?? "—") : "—"),
      },
    ],
    [
      canEditPlanning,
      applySiblingIngredientSelection,
      swapExecutionIngredient,
      swappingIngredientId,
      getSiblingIngredientSelection,
      ingredientOptions,
      batchCount,
      isBatchMode,
      optionMap,
      plannedOutputQuantity,
      quantityBasisHeader,
      quantityBasisValue,
      quantityPerUnitFromBasis,
      requirementMultiplier,
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
        createRow={() => makeBlankIngredient(requirementMultiplier, rows.length)}
        onRowsChange={handleRowsChange}
        addLabel="Add ingredient"
        initializeBlankRow={false}
        readOnly={!canEditPlanning}
        emptyMessage={
          order.productId
            ? "No ingredients yet."
            : "No ingredients yet. Pick a product to populate the bill of materials."
        }
        canDeleteRow={(row) => canEditPlanning && !row.defaultItemId}
        getDeleteDisabledReason={(row) =>
          !canEditPlanning
            ? planningLockedReason
            : row.defaultItemId
              ? "BOM ingredients stay on the order. Swap the variant or edit the quantity."
              : null
        }
        onDeleteRow={(row) => setConfirmDelete(row)}
      />
      {swapError ? (
        <p className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]">
          {swapError}
        </p>
      ) : null}

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
              variant="danger"
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


export function OperationsSection({ order }: { order: ManufacturingOrderDetail | null }) {
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
              <span className="text-[length:var(--text-sm)] text-[var(--color-muted)]">minutes</span>
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

export function NotesSection({
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
        hideLabel
        value={order.notes ?? ""}
        disabled={!canEdit}
        readOnlyValue={!canEdit}
        rows={3}
        className="min-h-20"
        readOnlyClassName="min-h-20 bg-[var(--color-surface-alt)] text-[length:var(--text-md)] leading-[var(--leading-md)] text-[var(--color-ink)]"
        placeholder="Notes for this order…"
        onCommit={(next) => {
          if (next !== order.notes) controller.patchHeader({ notes: next });
        }}
      />
    </CardSection>
  );
}
