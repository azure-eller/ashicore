"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CardField } from "@/components/card-page/card-field";
import {
  addInitialStock,
  deleteVariant,
  type AddInitialStockInput,
  type CreateItemCardResult,
  type CreateItemCardVariantInput,
  type ItemCardDto,
  type ItemCardVariantDto,
  type VariantOptionDto,
  type UpdateItemCardVariantInput,
} from "@/lib/api/clients/item-cards";
import { apiJson } from "@/lib/client/api";
import { formatQuantity, parseNumberOrZero } from "@/lib/format";
import {
  isNonNegativeNumberString,
  isPositiveNumberString,
} from "@/lib/schemas/shared";
import { cn } from "@/lib/utils";
import type { CardLotRow } from "./lot-grid-tab";
import styles from "./card-page.module.css";

export type VariantTableProps = {
  card: ItemCardDto;
  focusItemId: string | null;
  viewMode: "product" | "material";
  onVariantPatch: (variantId: string, patch: UpdateItemCardVariantInput) => void;
  onVariantReorder: (orderedVariantIds: string[]) => void;
  onCreateVariant: (input: CreateItemCardVariantInput) => Promise<CreateItemCardResult | null>;
  onFocusedVariantDeleted?: (nextVariantId: string) => void;
  allowVariantRows?: boolean;
};

/**
 * Maps a colDef field touched by AG Grid to the matching variant PATCH
 * payload. Numeric fields are coerced to the API's expected primitive.
 */
function buildVariantPatch(
  field: string,
  next: unknown,
): UpdateItemCardVariantInput | null {
  const value = typeof next === "string" ? next.trim() : next;
  const blank = value == null || value === "";

  switch (field) {
    case "sku":
    case "registeredBarcode":
    case "internalBarcode":
    case "supplierItemCode":
      return { [field]: blank ? null : String(value) } as UpdateItemCardVariantInput;
    case "defaultLeadTimeDays": {
      if (blank) return { defaultLeadTimeDays: null };
      const parsed = Number(value);
      if (!isNonNegativeNumberString(String(value))) return null;
      return { defaultLeadTimeDays: Math.trunc(parsed) };
    }
    case "minimumOrderQuantity": {
      if (blank) return { minimumOrderQuantity: null };
      if (!isPositiveNumberString(String(value))) return null;
      return { minimumOrderQuantity: String(value) };
    }
    case "defaultSellingPrice": {
      if (blank) return { defaultSellingPrice: null };
      if (!isNonNegativeNumberString(String(value))) return null;
      return { defaultSellingPrice: String(value) };
    }
    default:
      return null;
  }
}

export function NumericMoneyCell({
  value,
  scale = 2,
}: {
  value: string | null | undefined;
  scale?: number;
}) {
  if (value == null || value === "") {
    return (
      <>
        <span className={styles.placeholder}>—</span>
        <span className={styles.uom}>USD</span>
      </>
    );
  }
  const numeric = Number(value);
  return (
    <>
      <span className={styles.mono}>
        {Number.isFinite(numeric) ? numeric.toFixed(scale) : value}
      </span>
      <span className={styles.uom}>USD</span>
    </>
  );
}

function makeEmptyVariant(card: ItemCardDto): ItemCardVariantDto {
  return {
    id: `__draft_variant_${
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`
    }`,
    familyId: card.family.id,
    name: "",
    displayName: "",
    sku: null,
    itemType: card.family.itemType,
    optionCombinationKey: "",
    optionValues: [],
    duplicateCombinationWarnings: [],
    deletedAt: null,
    registeredBarcode: null,
    internalBarcode: null,
    supplierItemCode: null,
    defaultLeadTimeDays: null,
    minimumOrderQuantity: null,
    defaultSellingPrice: null,
    defaultPurchasePrice: null,
    inStockQty: "0",
    ingredientsCost: null,
    operationsCost: null,
    sortOrder: 0,
    sellable: card.family.itemType === "product",
  };
}

function isDraftVariant(row: ItemCardVariantDto) {
  return row.id.startsWith("__draft_variant_");
}

function StockQuantityAdjustmentDialog({
  adjustment,
  lotTracked,
  unitLabel,
  onOpenChange,
  onSaved,
}: {
  adjustment: {
    variant: ItemCardVariantDto;
    nextQuantity: string;
    previousQuantity: string;
  } | null;
  lotTracked: boolean;
  unitLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={adjustment != null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {adjustment ? (
          <StockQuantityAdjustmentBody
            adjustment={adjustment}
            lotTracked={lotTracked}
            unitLabel={unitLabel}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StockQuantityAdjustmentBody({
  adjustment,
  lotTracked,
  unitLabel,
  onCancel,
  onSaved,
}: {
  adjustment: {
    variant: ItemCardVariantDto;
    nextQuantity: string;
    previousQuantity: string;
  };
  lotTracked: boolean;
  unitLabel?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const previous = toNumber(adjustment.previousQuantity);
  const next = toNumber(adjustment.nextQuantity);
  const delta = roundQty(next - previous);
  const isIncrease = delta > 0;
  const [occurredAt, setOccurredAt] = useState(() => nowLocalIsoSecond());
  const [costPerUnit, setCostPerUnit] = useState("");
  const [note, setNote] = useState("");
  const lotsQuery = useQuery({
    queryKey: ["item-lots", adjustment.variant.id],
    queryFn: () =>
      apiJson<CardLotRow[]>(`/api/items/${adjustment.variant.id}/lots`, {
        fallbackError: "Failed to load lots.",
      }),
    enabled: !isIncrease && lotTracked,
  });

  const draftKey = isIncrease
    ? `${adjustment.variant.id}:increase:${delta}`
    : `${adjustment.variant.id}:decrease:${delta}:${(lotsQuery.data ?? [])
        .map((lot) => `${lot.id}:${lot.quantity}`)
        .join("|")}`;
  const defaultDraftLots = useMemo(
    () => (isIncrease ? [] : buildDecreaseDraft(lotsQuery.data ?? [], Math.abs(delta))),
    [delta, isIncrease, lotsQuery.data],
  );
  const [draftLotsState, setDraftLotsState] = useState<{
    key: string;
    rows: Array<{ lot: CardLotRow; nextQuantity: string }>;
  }>(() => ({ key: draftKey, rows: defaultDraftLots }));

  if (draftLotsState.key !== draftKey) {
    setDraftLotsState({ key: draftKey, rows: defaultDraftLots });
  }

  const draftLots = draftLotsState.rows;

  const increaseMutation = useMutation({
    mutationKey: ["item-card-action", adjustment.variant.id, "stock-increase"],
    mutationFn: (input: AddInitialStockInput) => addInitialStock(adjustment.variant.id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["item-card"] });
      onSaved();
    },
  });

  const decreaseMutation = useMutation({
    mutationKey: ["item-card-action", adjustment.variant.id, "stock-decrease"],
    mutationFn: async () => {
      const reason = note.trim() || "Stock adjustment";
      if (!lotTracked) {
        await apiJson<void>(`/api/items/${adjustment.variant.id}/stock-adjustments`, {
          method: "POST",
          body: {
            reason,
            newQuantity: adjustment.nextQuantity,
          },
          idempotencyKey: "variant-stock-adjust",
          fallbackError: "Failed to adjust stock.",
        });
        return;
      }
      const changedLots = draftLots
        .filter((row) => row.nextQuantity !== row.lot.quantity)
        .map((row) => ({ lotId: row.lot.id, newQuantity: row.nextQuantity }));
      if (changedLots.length === 0) return;
      await apiJson<void>(`/api/items/${adjustment.variant.id}/stock-adjustments`, {
        method: "POST",
        body: {
          reason,
          lots: changedLots,
        },
        idempotencyKey: "variant-stock-adjust",
        fallbackError: "Failed to adjust stock.",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["item-card"] });
      onSaved();
    },
  });

  const adjustedDelta = roundQty(
    draftLots.reduce(
      (sum, row) => sum + Math.max(0, toNumber(row.lot.quantity) - toNumber(row.nextQuantity)),
      0,
    ),
  );
  const decreaseNeeded = Math.abs(delta);
  const decreaseValid = isIncrease || Math.abs(adjustedDelta - decreaseNeeded) <= 0.0001;
  const mutationError = (increaseMutation.error ?? decreaseMutation.error) as Error | null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isIncrease ? "Increase stock" : "Reduce stock"}</DialogTitle>
        <DialogDescription>
          {adjustment.variant.displayName} · {formatQuantity(adjustment.previousQuantity)} to{" "}
          {formatQuantity(adjustment.nextQuantity)} {unitLabel ?? ""}
        </DialogDescription>
      </DialogHeader>

      {isIncrease ? (
        <div className="grid gap-(--space-4) md:grid-cols-2">
          <CardField
            label="Quantity to add"
            htmlFor="stock-adjust-quantity-add"
            controlStyle="dialog"
          >
            <div className="flex items-center gap-(--space-2)">
              <Input
                id="stock-adjust-quantity-add"
                value={String(delta)}
                readOnly
                className={styles.mono}
              />
              {unitLabel ? (
                <span className="text-[length:var(--text-sm)] text-muted-foreground">
                  {unitLabel}
                </span>
              ) : null}
            </div>
          </CardField>
          <CardField
            label="Cost per unit"
            htmlFor="stock-adjust-cost-per-unit"
            controlStyle="dialog"
          >
            <div className="flex items-center gap-(--space-2)">
              <Input
                id="stock-adjust-cost-per-unit"
                value={costPerUnit}
                onChange={(event) => setCostPerUnit(event.target.value)}
                inputMode="decimal"
              />
              <span className="text-[length:var(--text-sm)] text-muted-foreground">USD</span>
            </div>
          </CardField>
          <CardField
            label="Occurred at"
            htmlFor="stock-adjust-occurred-at"
            controlStyle="dialog"
          >
            <DateTimePicker
              id="stock-adjust-occurred-at"
              value={occurredAt}
              onChange={setOccurredAt}
            />
          </CardField>
          <CardField
            label="Note"
            htmlFor="stock-adjust-note-increase"
            controlStyle="dialog"
          >
            <Input
              id="stock-adjust-note-increase"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </CardField>
        </div>
      ) : !lotTracked ? (
        <div className="grid gap-(--space-4)">
          <CardField
            label="Quantity after adjustment"
            htmlFor="stock-adjust-quantity-after"
            controlStyle="dialog"
          >
            <div className="flex items-center gap-(--space-2)">
              <Input
                id="stock-adjust-quantity-after"
                value={adjustment.nextQuantity}
                readOnly
                className={styles.mono}
              />
              {unitLabel ? (
                <span className="text-[length:var(--text-sm)] text-muted-foreground">
                  {unitLabel}
                </span>
              ) : null}
            </div>
          </CardField>
          <CardField
            label="Note"
            htmlFor="stock-adjust-note-untracked"
            controlStyle="dialog"
          >
            <Input
              id="stock-adjust-note-untracked"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </CardField>
        </div>
      ) : lotsQuery.isLoading ? (
        <div className="grid min-h-40 place-items-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : lotsQuery.error ? (
        <FieldError>
          {lotsQuery.error instanceof Error ? lotsQuery.error.message : "Failed to load lots."}
        </FieldError>
      ) : (
        <div className="grid gap-(--space-4)">
          <div className="grid gap-(--space-2)">
            <div className="grid grid-cols-[1fr_120px_120px] gap-(--space-2) text-[length:var(--text-xs)] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <span>Lot</span>
              <span>Current</span>
              <span>After</span>
            </div>
            {draftLots.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-muted-foreground">
                No available lots to reduce.
              </p>
            ) : (
              draftLots.map((row, index) => (
                <div
                  key={row.lot.id}
                  className="grid grid-cols-[1fr_120px_120px] items-center gap-(--space-2)"
                >
                  <span className={styles.mono}>{row.lot.lotNumber}</span>
                  <span className={styles.mono}>{formatQuantity(row.lot.quantity)}</span>
                  <Input
                    value={row.nextQuantity}
                    inputMode="decimal"
                    className={styles.mono}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      setDraftLotsState((current) => ({
                        ...current,
                        rows: current.rows.map((currentRow, currentIndex) =>
                          currentIndex === index
                            ? { ...currentRow, nextQuantity: value }
                            : currentRow,
                        ),
                      }));
                    }}
                  />
                </div>
              ))
            )}
          </div>
          <CardField
            label="Note"
            htmlFor="stock-adjust-note-lot-tracked"
            controlStyle="dialog"
          >
            <Input
              id="stock-adjust-note-lot-tracked"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </CardField>
          <p className="text-[length:var(--text-sm)] text-muted-foreground">
            Reducing {formatQuantity(String(adjustedDelta))} of{" "}
            {formatQuantity(String(decreaseNeeded))} {unitLabel ?? ""}.
          </p>
        </div>
      )}

      {mutationError ? <FieldError>{mutationError.message}</FieldError> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={
            increaseMutation.isPending ||
            decreaseMutation.isPending ||
            (!isIncrease && lotTracked && !decreaseValid)
          }
          onClick={() => {
            if (isIncrease) {
              increaseMutation.mutate({
                quantity: String(delta),
                costPerUnit: costPerUnit.trim() === "" ? null : costPerUnit.trim(),
                occurredAt: new Date(occurredAt).toISOString(),
                note: note.trim() === "" ? null : note.trim(),
              });
              return;
            }
            decreaseMutation.mutate();
          }}
        >
          {increaseMutation.isPending || decreaseMutation.isPending
            ? "Adjusting..."
            : "Adjust stock"}
        </Button>
      </DialogFooter>
    </>
  );
}

function buildDecreaseDraft(lots: CardLotRow[], decreaseQuantity: number) {
  let remaining = decreaseQuantity;
  const rows: Array<{ lot: CardLotRow; nextQuantity: string }> = [];

  for (const lot of lots) {
    const current = toNumber(lot.quantity);
    if (current <= 0) continue;

    if (remaining <= 0) {
      rows.push({ lot, nextQuantity: lot.quantity });
      continue;
    }
    const deduction = Math.min(current, remaining);
    rows.push({
      lot,
      nextQuantity: String(roundQty(current - deduction)),
    });
    remaining = roundQty(remaining - deduction);
  }

  return rows;
}

const toNumber = parseNumberOrZero;

function roundQty(value: number) {
  return Math.round(value * 10000) / 10000;
}

function nowLocalIsoSecond(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function StockQuantityCell({
  quantity,
  unitLabel,
}: {
  quantity: string;
  unitLabel: string | null | undefined;
}) {
  const numeric = Number(quantity);
  return (
    <>
      <span className={Number.isFinite(numeric) && numeric < 0 ? styles.stockNeg : styles.mono}>
        {formatQuantity(quantity)}
      </span>
      {unitLabel ? <span className={styles.uom}>{unitLabel}</span> : null}
    </>
  );
}

function buildVariantOptionPatch(
  row: ItemCardVariantDto,
  activeOptions: VariantOptionDto[],
): UpdateItemCardVariantInput | null {
  const optionValueIdsByOptionId: Record<string, string> = {};
  for (const option of activeOptions) {
    const assigned = row.optionValues.find((value) => value.optionId === option.id);
    if (!assigned) return null;
    optionValueIdsByOptionId[option.id] = assigned.valueId;
  }
  return { optionValueIdsByOptionId };
}

function buildVariantCreateInput(
  row: ItemCardVariantDto,
  activeOptions: VariantOptionDto[],
): CreateItemCardVariantInput | null {
  const optionPatch = buildVariantOptionPatch(row, activeOptions);
  if (!optionPatch?.optionValueIdsByOptionId) return null;
  return {
    optionValueIdsByOptionId: optionPatch.optionValueIdsByOptionId,
    sku: row.sku,
    registeredBarcode: row.registeredBarcode,
    internalBarcode: row.internalBarcode,
    supplierItemCode: row.supplierItemCode,
    defaultLeadTimeDays: row.defaultLeadTimeDays,
    minimumOrderQuantity: row.minimumOrderQuantity,
    defaultSellingPrice: row.defaultSellingPrice,
    sellable: row.sellable,
  };
}

function replaceVariantOptionValue(
  row: ItemCardVariantDto,
  option: VariantOptionDto,
  nextLabel: string,
  activeOptions: VariantOptionDto[],
) {
  const selectedValue = option.values.find(
    (value) => value.disabledAt == null && value.label === nextLabel,
  );
  if (!selectedValue) return false;

  const current = row.optionValues.find((value) => value.optionId === option.id);
  if (current?.valueId === selectedValue.id) return false;

  const optionOrder = new Map(activeOptions.map((activeOption, index) => [activeOption.id, index]));
  row.optionValues = [
    ...row.optionValues.filter((value) => value.optionId !== option.id),
    {
      optionId: option.id,
      optionName: option.name,
      optionCode: option.code,
      valueId: selectedValue.id,
      valueLabel: selectedValue.label,
      valueCode: selectedValue.code,
      optionDisabledAt: option.disabledAt as Date | null,
      valueDisabledAt: selectedValue.disabledAt as Date | null,
    },
  ].sort(
    (left, right) =>
      (optionOrder.get(left.optionId) ?? Number.MAX_SAFE_INTEGER) -
      (optionOrder.get(right.optionId) ?? Number.MAX_SAFE_INTEGER),
  );

  return true;
}

export function VariantTable({
  card,
  focusItemId,
  viewMode,
  onVariantPatch,
  onVariantReorder,
  onCreateVariant,
  onFocusedVariantDeleted,
  allowVariantRows = true,
}: VariantTableProps) {
  const activeOptions = useMemo(
    () => card.options.filter((option) => option.disabledAt == null),
    [card.options],
  );
  const unitName = card.family.unitName;
  const visibleVariants = useMemo(
    () => card.variants.filter((variant) => variant.deletedAt == null),
    [card.variants],
  );
  const mutationItemId = visibleVariants[0]?.id ?? card.variants[0]?.id ?? card.family.id;

  // Local copy of the rows AG Grid renders. Sync from props on every render
  // via the "adjust state in render" pattern (React 19-recommended).
  const [rows, setRows] = useState<ItemCardVariantDto[]>(visibleVariants);
  const [lastSynced, setLastSynced] = useState(visibleVariants);
  if (lastSynced !== visibleVariants) {
    setLastSynced(visibleVariants);
    setRows((currentRows) => [
      ...visibleVariants,
      ...currentRows.filter(isDraftVariant),
    ]);
  }

  const queryClient = useQueryClient();
  const [confirmDeleteVariant, setConfirmDeleteVariant] =
    useState<ItemCardVariantDto | null>(null);
  const [stockAdjustment, setStockAdjustment] = useState<{
    variant: ItemCardVariantDto;
    nextQuantity: string;
    previousQuantity: string;
  } | null>(null);
  const creatingDraftIdsRef = useRef(new Set<string>());

  const deleteMutation = useMutation({
    mutationKey: ["item-card-action", mutationItemId, "variant-delete"],
    mutationFn: (variantId: string) => deleteVariant(variantId),
    onSuccess: (_result, variantId) => {
      const nextFocusedVariant = visibleVariants.find((variant) => variant.id !== variantId);
      setRows((currentRows) => currentRows.filter((row) => row.id !== variantId));
      if (variantId === focusItemId && nextFocusedVariant) {
        onFocusedVariantDeleted?.(nextFocusedVariant.id);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });

  const handleRowsChange = useCallback(
    (next: ItemCardVariantDto[], change: EditableLineDataGridChange<ItemCardVariantDto>) => {
      setRows(next);
      if (change.type === "row_reordered") {
        onVariantReorder(next.map((row) => row.id));
        return;
      }
      if (change.type !== "cell_edit_committed" || !change.row) return;
      if (change.colId === "inStock") {
        setStockAdjustment({
          variant: change.row,
          nextQuantity: String(change.newValue ?? "0"),
          previousQuantity: String(change.oldValue ?? "0"),
        });
        return;
      }
      const payload = change.colId?.startsWith("option:")
        ? buildVariantOptionPatch(change.row, activeOptions)
        : change.field
          ? buildVariantPatch(change.field, change.newValue)
          : null;
      if (isDraftVariant(change.row)) {
        if (creatingDraftIdsRef.current.has(change.row.id)) return;
        const input = buildVariantCreateInput(change.row, activeOptions);
        if (!input) return;
        const tempId = change.row.id;
        creatingDraftIdsRef.current.add(tempId);
        void onCreateVariant(input)
          .then((result) => {
            if (!result) return;
            const serverRows = result.card.variants.filter(
              (variant) => variant.deletedAt == null,
            );
            setRows((currentRows) => [
              ...serverRows,
              ...currentRows.filter(
                (row) => isDraftVariant(row) && row.id !== tempId,
              ),
            ]);
          })
          .catch(() => undefined)
          .finally(() => {
            creatingDraftIdsRef.current.delete(tempId);
          });
        return;
      }
      if (!payload) return;
      onVariantPatch(change.row.id, payload);
    },
    [activeOptions, onCreateVariant, onVariantPatch, onVariantReorder],
  );

  const columns = useMemo<ColDef<ItemCardVariantDto>[]>(() => {
    const cols: ColDef<ItemCardVariantDto>[] = [];

    // Option-value columns are specialized variant axes: dropdown-only edits
    // constrained to the configured values for that axis.
    for (const option of activeOptions) {
      const activeValues = option.values.filter((value) => value.disabledAt == null);
      cols.push({
        colId: `option:${option.id}`,
        headerName: option.name,
        editable: activeValues.length > 0,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: activeValues.map((value) => value.label),
        },
        flex: 1,
        minWidth: 96,
        valueGetter: (params) => {
          const assigned = params.data?.optionValues.find(
            (value) => value.optionId === option.id,
          );
          return assigned?.valueLabel ?? "";
        },
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          if (!params.data || typeof params.newValue !== "string") return false;
          return replaceVariantOptionValue(
            params.data,
            option,
            params.newValue,
            activeOptions,
          );
        },
        cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => {
          if (!params.data) return null;
          const assigned = params.data.optionValues.find(
            (value) => value.optionId === option.id,
          );
          if (!assigned) {
            return <span className={styles.placeholder}>—</span>;
          }
          return (
            <span
              className={cn(
                styles.sizePill,
                assigned.valueDisabledAt && styles.chipDisabled,
              )}
            >
              {assigned.valueLabel}
            </span>
          );
        },
      });
    }

    const textEditable = (field: keyof ItemCardVariantDto): ColDef<ItemCardVariantDto> => ({
      field,
      editable: true,
      cellEditor: "agTextCellEditor",
      cellClass: styles.mono,
      valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
        const trimmed =
          typeof params.newValue === "string"
            ? params.newValue.trim() || null
            : params.newValue;
        const current = (params.data as Record<string, unknown>)[field as string] ?? null;
        if (trimmed === current) return false;
        (params.data as Record<string, unknown>)[field as string] = trimmed;
        return true;
      },
    });

    cols.push({
      ...textEditable("sku"),
      headerName: "Variant code/SKU",
      flex: 1.1,
      minWidth: 140,
      cellEditorParams: { placeholder: "E.g. P-1, M-1" },
    });

    if (viewMode === "product") {
      cols.push({
        field: "defaultSellingPrice",
        colId: "defaultSellingPrice",
        headerName: "Default sales price",
        type: "rightAligned",
        editable: true,
        cellEditor: "agTextCellEditor",
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          const raw = params.newValue;
          if (raw === "" || raw == null) {
            if (params.data.defaultSellingPrice == null) return false;
            params.data.defaultSellingPrice = null;
            return true;
          }
          const trimmed = String(raw).trim();
          if (!isNonNegativeNumberString(trimmed)) return false;
          if (params.data.defaultSellingPrice === trimmed) return false;
          params.data.defaultSellingPrice = trimmed;
          return true;
        },
        flex: 0.9,
        minWidth: 140,
        cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => (
          <NumericMoneyCell value={params.data?.defaultSellingPrice} scale={2} />
        ),
      });
    }

    cols.push({
      ...textEditable("registeredBarcode"),
      headerName: "Registered barcode",
      flex: 1,
      minWidth: 140,
    });
    cols.push({
      ...textEditable("internalBarcode"),
      headerName: "Internal barcode",
      flex: 1,
      minWidth: 140,
    });

    if (viewMode === "product") {
      cols.push({
        colId: "ingredientsCost",
        headerName: "Ingredients cost",
        type: "rightAligned",
        flex: 0.9,
        minWidth: 140,
        cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => (
          <NumericMoneyCell value={params.data?.ingredientsCost} scale={5} />
        ),
      });
      cols.push({
        colId: "operationsCost",
        headerName: "Operations cost",
        type: "rightAligned",
        flex: 0.9,
        minWidth: 140,
        cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => (
          <NumericMoneyCell value={params.data?.operationsCost} scale={2} />
        ),
      });
    }

    if (viewMode === "material") {
      cols.push({
        ...textEditable("supplierItemCode"),
        headerName: "Supplier item code",
        flex: 1,
        minWidth: 140,
      });
      cols.push({
        field: "defaultLeadTimeDays",
        headerName: "Lead time",
        type: "rightAligned",
        editable: true,
        cellEditor: "agNumberCellEditor",
        cellClass: styles.mono,
        flex: 0.6,
        minWidth: 100,
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          const next = params.newValue;
          if (next === "" || next == null) {
            if (params.data.defaultLeadTimeDays == null) return false;
            params.data.defaultLeadTimeDays = null;
            return true;
          }
          const parsed = Number(next);
          if (!isNonNegativeNumberString(String(next))) return false;
          const truncated = Math.trunc(parsed);
          if (params.data.defaultLeadTimeDays === truncated) return false;
          params.data.defaultLeadTimeDays = truncated;
          return true;
        },
      });
      cols.push({
        field: "minimumOrderQuantity",
        headerName: "MOQ",
        type: "rightAligned",
        editable: true,
        cellEditor: "agTextCellEditor",
        cellClass: styles.mono,
        flex: 0.6,
        minWidth: 100,
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          const raw = params.newValue;
          if (raw === "" || raw == null) {
            if (params.data.minimumOrderQuantity == null) return false;
            params.data.minimumOrderQuantity = null;
            return true;
          }
          const trimmed = String(raw).trim();
          if (!isPositiveNumberString(trimmed)) return false;
          if (params.data.minimumOrderQuantity === trimmed) return false;
          params.data.minimumOrderQuantity = trimmed;
          return true;
        },
      });
    }

    cols.push({
      field: "inStockQty",
      colId: "inStock",
      headerName: "In stock",
      type: "rightAligned",
      editable: true,
      cellEditor: "agTextCellEditor",
      flex: 0.8,
      minWidth: 140,
      valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
        const trimmed = String(params.newValue ?? "").trim();
        if (!trimmed || !isNonNegativeNumberString(trimmed)) return false;
        const parsed = Number(trimmed);
        const next = String(Math.round(parsed * 10000) / 10000);
        if (params.data.inStockQty === next) return false;
        params.data.inStockQty = next;
        return true;
      },
      cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => {
        if (!params.data) {
          return <span className={styles.placeholder}>—</span>;
        }
        return (
          <StockQuantityCell
            quantity={params.data.inStockQty}
            unitLabel={unitName}
          />
        );
      },
    });

    return cols;
  }, [
    activeOptions,
    unitName,
    viewMode,
  ]);

  const canManageVariantRows = allowVariantRows && activeOptions.length > 0;

  return (
    <>
      <EditableLineDataGrid<ItemCardVariantDto>
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={() => makeEmptyVariant(card)}
        onRowsChange={handleRowsChange}
        addLabel="Add row"
        enableAddRow={canManageVariantRows}
        enableReorder={canManageVariantRows}
        enableDelete={canManageVariantRows}
        initializeBlankRow={false}
        emptyMessage="No item rows yet."
        canDeleteRow={(_row, currentRows) => currentRows.length > 1}
        getDeleteDisabledReason={(_row, currentRows) =>
          currentRows.length <= 1 ? "At least one variant is required." : null
        }
        onDeleteRow={(row) => {
          if (isDraftVariant(row)) {
            setRows((currentRows) => currentRows.filter((current) => current.id !== row.id));
            return;
          }
          setConfirmDeleteVariant(row);
        }}
        rowHasError={(row) => row.duplicateCombinationWarnings.length > 0}
      />

      <AlertDialog
        open={confirmDeleteVariant != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteVariant(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete variant?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteVariant?.displayName} will be removed from this card.
              {deleteMutation.error ? (
                <span className="block mt-(--space-2) text-destructive">
                  {(deleteMutation.error as Error).message}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => deleteMutation.reset()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!confirmDeleteVariant) return;
                deleteMutation.mutate(confirmDeleteVariant.id, {
                  onSuccess: () => setConfirmDeleteVariant(null),
                });
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StockQuantityAdjustmentDialog
        adjustment={stockAdjustment}
        lotTracked={card.family.lotTrackingMode === "tracked"}
        unitLabel={unitName ?? undefined}
        onOpenChange={(open) => {
          if (open) return;
          setStockAdjustment(null);
          setRows(visibleVariants);
        }}
        onSaved={() => {
          setStockAdjustment(null);
          void queryClient.invalidateQueries({ queryKey: ["item-card"] });
        }}
      />
    </>
  );
}
