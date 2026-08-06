"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  CellClassParams,
  ICellRendererParams,
  ValueSetterParams,
} from "ag-grid-community";

import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  createLotAgeMinDaysConstraint,
  formatMinimumLotAgeRequirementLabel,
  summarizeComponentRequirements,
} from "@/lib/bom/constraints";
import { createClientId } from "@/lib/client-id";
import {
  buildIndexedFormErrorMap,
  getNestedFormErrorMessage,
  normalizeNullableTextValue,
} from "@/lib/format";
import { calculateEstimatedComponentContribution } from "@/lib/inventory/recipe-cost-preview";
import type { RecipeBasis } from "@/lib/manufacturing/consumption";
import { isPositiveNumberString } from "@/lib/schemas/shared";
import { BOM_ESTIMATED_CONTRIBUTION_TOOLTIP } from "@/lib/tooltip-copy";
import { cn } from "@/lib/utils";

type AvailableComponent = {
  id: string;
  name: string;
  familyId: string | null;
  displayName: string;
  itemType: string;
  unit: string;
  estimatedUnitCost?: string | null;
};

type BomAlternateRow = {
  itemId: string;
  /** Nullable on the way in: recipes saved before alternates carried a number. */
  quantity?: string | null;
};

type BomPayloadRow = {
  componentId: string | null;
  quantity: string | null;
  minimumLotAgeDays?: string | number | null;
  alternates?: BomAlternateRow[] | null;
};

type BomGridRow = BomPayloadRow & {
  clientRowId: string;
};

type BomColumnKey = "componentId" | "quantity" | "minimumLotAgeDays";

type BomErrorState = {
  gridError: string | null;
  byRowId: Map<string, Map<BomColumnKey, string>>;
};

type BomEditorChangeMeta = {
  dirty: boolean;
  change: EditableLineDataGridChange<BomGridRow>;
};

const blankBomLine = {
  componentId: "",
  quantity: null,
  minimumLotAgeDays: null,
};

function createClientRowId() {
  return createClientId("bom-row");
}

const normalizeTextCell = normalizeNullableTextValue;
const normalizeMinimumLotAge = normalizeNullableTextValue;

function createBlankGridRow(): BomGridRow {
  return {
    ...blankBomLine,
    clientRowId: createClientRowId(),
  };
}

function toGridRows(rows: BomPayloadRow[] | undefined): BomGridRow[] {
  const gridRows =
    rows?.map((row) => ({
      ...blankBomLine,
      ...row,
      componentId: row.componentId ?? "",
      clientRowId: createClientRowId(),
    })) ?? [];

  return gridRows.length > 0 ? gridRows : [createBlankGridRow()];
}

function toPayloadRows(rows: BomGridRow[]): BomPayloadRow[] {
  return rows.map((row) => ({
    componentId: row.componentId ?? "",
    quantity: normalizeTextCell(row.quantity),
    minimumLotAgeDays: normalizeMinimumLotAge(row.minimumLotAgeDays),
    alternates: row.alternates ?? [],
  }));
}

function isBlankBomRow(row: BomPayloadRow) {
  const componentId = row.componentId?.trim() ?? "";
  const quantity = row.quantity?.trim() ?? "";
  const minimumLotAgeDays =
    row.minimumLotAgeDays == null ? "" : String(row.minimumLotAgeDays).trim();

  return componentId === "" && quantity === "" && minimumLotAgeDays === "";
}

export function toBomRevisionPayloadRows(rows: BomPayloadRow[]) {
  return rows
    .filter((row) => !isBlankBomRow(row))
    .map((row) => ({
      componentId: row.componentId ?? "",
      quantity: row.quantity ?? "",
      minimumLotAgeDays: row.minimumLotAgeDays ?? null,
      alternates: row.alternates ?? [],
    }));
}

function comparablePayload(rows: BomGridRow[]) {
  return JSON.stringify(
    toPayloadRows(rows)
      .filter((row) => !isBlankBomRow(row))
      .map((row) => ({
        componentId: row.componentId ?? "",
        quantity: row.quantity ?? null,
        minimumLotAgeDays: row.minimumLotAgeDays ?? null,
        alternates: [...(row.alternates ?? [])].sort((left, right) =>
          left.itemId.localeCompare(right.itemId)
        ),
      }))
  );
}

function buildErrorState(error: unknown, rows: BomGridRow[]): BomErrorState {
  const byRowId = new Map<string, Map<BomColumnKey, string>>();
  const gridMessages: string[] = [];
  const topLevelMessage = getNestedFormErrorMessage(error);

  if (topLevelMessage) {
    gridMessages.push(topLevelMessage);
  }

  const fieldErrors =
    error && typeof error === "object" && "fieldErrors" in error
      ? (error as { fieldErrors?: Record<string, string[]> }).fieldErrors
      : null;
  if (fieldErrors) {
    for (const [path, messages] of Object.entries(fieldErrors)) {
      const match = /^bom\.(\d+)\.(componentId|quantity|minimumLotAgeDays)$/.exec(
        path,
      );
      if (!match) continue;
      const row = rows[Number(match[1])];
      const key = match[2] as BomColumnKey;
      const message = messages[0];
      if (!row || !message) continue;
      const rowMessages = byRowId.get(row.clientRowId) ?? new Map<BomColumnKey, string>();
      rowMessages.set(key, message);
      byRowId.set(row.clientRowId, rowMessages);
    }
  }

  const indexedErrors = buildIndexedFormErrorMap(
    error,
    rows,
    [
      "componentId",
      "quantity",
      "minimumLotAgeDays",
    ],
    (row) => row.clientRowId,
  );
  indexedErrors.forEach((messages, rowId) => {
    byRowId.set(rowId, messages);
  });

  return {
    gridError: gridMessages[0] ?? null,
    byRowId,
  };
}

function hasCellError(
  errorState: BomErrorState,
  row: BomGridRow | undefined,
  key: BomColumnKey
) {
  if (!row) {
    return false;
  }

  return errorState.byRowId.get(row.clientRowId)?.has(key) ?? false;
}

function ComponentCell({
  data,
  componentMap,
}: ICellRendererParams<BomGridRow> & {
  componentMap: Map<string, AvailableComponent>;
}) {
  if (!data?.componentId) {
    return <span className="text-[var(--color-ink-faint)]">Search items...</span>;
  }

  return (
    <span className="block truncate">
      {componentMap.get(data.componentId)?.displayName ??
        componentMap.get(data.componentId)?.name ??
        data.componentId}
    </span>
  );
}

function getRequirementSummary(row: BomGridRow | undefined) {
  const days = normalizeMinimumLotAge(row?.minimumLotAgeDays);
  const parsedDays = days == null ? null : Number(days);
  const lotAgeConstraint =
    parsedDays != null && Number.isInteger(parsedDays) && parsedDays > 0
      ? createLotAgeMinDaysConstraint(parsedDays)
      : null;

  return summarizeComponentRequirements(lotAgeConstraint ? [lotAgeConstraint] : []);
}

function getVariantSummary(
  data: BomGridRow | undefined,
  componentMap: Map<string, AvailableComponent>
) {
  const count = data?.alternates?.length ?? 0;
  if (count === 0) {
    return data?.componentId && getFamilySiblings(data.componentId, componentMap).length > 0
      ? "None"
      : "—";
  }
  return count === 1 ? "1 variant" : `${count} variants`;
}

/** Every other item sharing this component's family. Empty when it has no siblings. */
function getFamilySiblings(
  componentId: string,
  componentMap: Map<string, AvailableComponent>
) {
  const component = componentMap.get(componentId);
  if (!component?.familyId) return [];
  return [...componentMap.values()].filter(
    (candidate) =>
      candidate.familyId === component.familyId && candidate.id !== component.id
  );
}

/**
 * Chooses which same-family variants may replace this ingredient, and how much of each.
 *
 * The quantity is typed per variant in that variant's own unit and is never derived — a
 * larger package is a different number, not a multiple of the base line. A variant left
 * unchecked simply is not offered on manufacturing orders.
 */
function VariantsCell({
  data,
  rows,
  componentMap,
  emitRowsChange,
  readOnly,
}: ICellRendererParams<BomGridRow> & {
  rows: BomGridRow[];
  componentMap: Map<string, AvailableComponent>;
  emitRowsChange: (
    nextRows: BomGridRow[],
    change: EditableLineDataGridChange<BomGridRow>,
  ) => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const summary = getVariantSummary(data, componentMap);
  const siblings = data?.componentId
    ? getFamilySiblings(data.componentId, componentMap)
    : [];

  if (!data) {
    return null;
  }

  if (readOnly || siblings.length === 0) {
    return (
      <span
        className={cn(
          "block truncate px-(--space-3)",
          summary !== "None" && summary !== "—"
            ? undefined
            : "text-[var(--color-ink-faint)]"
        )}
      >
        {summary}
      </span>
    );
  }

  const invalid = Object.entries(draft).some(
    ([, value]) => value.trim() !== "" && !(Number(value) > 0)
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          const next: Record<string, string> = {};
          for (const alternate of data.alternates ?? []) {
            next[alternate.itemId] = alternate.quantity ?? "";
          }
          setDraft(next);
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-full w-full justify-start px-(--space-3)",
            summary === "None" && "text-[var(--color-ink-faint)]"
          )}
        >
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <PopoverHeader>
          <PopoverTitle>Ingredient variants</PopoverTitle>
          <PopoverDescription>
            How much of each replaces this line
          </PopoverDescription>
        </PopoverHeader>
        <div className="space-y-(--space-4)">
          {siblings.map((sibling) => {
            const value = draft[sibling.id] ?? "";
            const checked = sibling.id in draft;
            const badValue = checked && value.trim() !== "" && !(Number(value) > 0);
            return (
              <div key={sibling.id} className="flex items-start gap-(--space-4)">
                <Checkbox
                  id={`variant-${data.clientRowId}-${sibling.id}`}
                  checked={checked}
                  onCheckedChange={(next) => {
                    setDraft((current) => {
                      const copy = { ...current };
                      if (next === true) {
                        copy[sibling.id] = current[sibling.id] ?? "";
                      } else {
                        delete copy[sibling.id];
                      }
                      return copy;
                    });
                  }}
                />
                <div className="min-w-0 flex-1 space-y-(--space-3)">
                  <Label htmlFor={`variant-${data.clientRowId}-${sibling.id}`}>
                    {sibling.displayName}
                  </Label>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-(--space-3)">
                    <Input
                      inputMode="decimal"
                      value={value}
                      disabled={!checked}
                      aria-invalid={badValue}
                      aria-label={`${sibling.displayName} quantity`}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [sibling.id]: event.target.value,
                        }))
                      }
                    />
                    <span className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                      {sibling.unit}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {invalid ? (
            <p className="text-[length:var(--text-xs)] text-[var(--status-danger-ink)]">
              Quantities must be greater than 0.
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-(--space-3)">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              invalid ||
              Object.entries(draft).some(([, value]) => value.trim() === "")
            }
            onClick={() => {
              const nextAlternates: BomAlternateRow[] = Object.entries(draft).map(
                ([itemId, quantity]) => ({ itemId, quantity: quantity.trim() })
              );
              const nextRows = rows.map((row) =>
                row.clientRowId === data.clientRowId
                  ? { ...row, alternates: nextAlternates }
                  : row
              );
              const nextRow = nextRows.find(
                (row) => row.clientRowId === data.clientRowId
              );
              emitRowsChange(nextRows, {
                type: "cell_edit_committed",
                field: "componentId",
                colId: "alternates",
                row: nextRow,
                rows: nextRows,
              });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RequirementsCell({
  data,
  rows,
  emitRowsChange,
  readOnly,
}: ICellRendererParams<BomGridRow> & {
  rows: BomGridRow[];
  emitRowsChange: (
    nextRows: BomGridRow[],
    change: EditableLineDataGridChange<BomGridRow>,
  ) => void;
  readOnly: boolean;
}) {
  const currentDays = normalizeMinimumLotAge(data?.minimumLotAgeDays);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(Boolean(currentDays));
  const [draftDays, setDraftDays] = useState(currentDays ?? "");
  const dayCount = Number(draftDays);
  const hasDayError =
    enabled &&
    (!/^[1-9][0-9]*$/.test(draftDays.trim()) ||
      !Number.isInteger(dayCount) ||
      dayCount <= 0);
  const summary = getRequirementSummary(data);

  if (!data) {
    return null;
  }

  if (readOnly) {
    return (
      <span
        className={cn(
          "block truncate px-(--space-3)",
          summary === "None" && "text-[var(--color-ink-faint)]",
        )}
      >
        {summary}
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          const nextDays = normalizeMinimumLotAge(data.minimumLotAgeDays);
          setEnabled(Boolean(nextDays));
          setDraftDays(nextDays ?? "");
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-full w-full justify-start px-(--space-3)",
            summary === "None" && "text-[var(--color-ink-faint)]"
          )}
        >
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Component requirements</PopoverTitle>
          <PopoverDescription>
            Minimum lot age
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex items-start gap-(--space-4)">
          <Checkbox
            id={`require-aged-lots-${data.clientRowId}`}
            checked={enabled}
            onCheckedChange={(checked) => {
              const nextEnabled = checked === true;
              setEnabled(nextEnabled);
              if (nextEnabled && draftDays.trim() === "") {
                setDraftDays("14");
              }
            }}
          />
          <div className="min-w-0 flex-1 space-y-(--space-4)">
            <Label htmlFor={`require-aged-lots-${data.clientRowId}`}>
              Require aged lots
            </Label>
            <Label
              htmlFor={`minimum-lot-age-days-${data.clientRowId}`}
              className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]"
            >
              Minimum age
            </Label>
            <div className="grid grid-cols-[1fr_auto] items-center gap-(--space-3)">
              <Input
                id={`minimum-lot-age-days-${data.clientRowId}`}
                inputMode="numeric"
                value={draftDays}
                disabled={!enabled}
                aria-invalid={hasDayError}
                onChange={(event) => setDraftDays(event.target.value)}
              />
              <span className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                days
              </span>
            </div>
            <p className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
              Lots are eligible when their received date is at least this many days old.
            </p>
            {enabled && !hasDayError && draftDays.trim() !== "" ? (
              <p className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                {formatMinimumLotAgeRequirementLabel(Number(draftDays))}
              </p>
            ) : null}
            {hasDayError ? (
              <p className="text-[length:var(--text-xs)] text-[var(--status-danger-ink)]">
                Minimum age must be a positive whole number.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-(--space-3)">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={hasDayError}
            onClick={() => {
              const nextValue = enabled ? normalizeMinimumLotAge(draftDays) : null;
              if (nextValue === normalizeMinimumLotAge(data.minimumLotAgeDays)) {
                setOpen(false);
                return;
              }
              const nextRows = rows.map((row) =>
                row.clientRowId === data.clientRowId
                  ? { ...row, minimumLotAgeDays: nextValue }
                  : row
              );
              const nextRow = nextRows.find(
                (row) => row.clientRowId === data.clientRowId
              );
              emitRowsChange(nextRows, {
                type: "cell_edit_committed",
                field: "minimumLotAgeDays",
                colId: "minimumLotAgeDays",
                row: nextRow,
                rows: nextRows,
              });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getComponentUnit(
  row: BomGridRow | undefined,
  componentMap: Map<string, AvailableComponent>
) {
  return row?.componentId ? (componentMap.get(row.componentId)?.unit ?? null) : null;
}

function QuantityCell({
  data,
  componentMap,
}: ICellRendererParams<BomGridRow> & {
  componentMap: Map<string, AvailableComponent>;
}) {
  const unit = getComponentUnit(data, componentMap);

  return (
    <span className="flex min-w-0 items-center gap-(--space-3)">
      <span className="min-w-0 truncate">{data?.quantity ?? ""}</span>
      {unit ? (
        <span className="ml-auto truncate text-[var(--color-ink-faint)]">{unit}</span>
      ) : null}
    </span>
  );
}

function EstimatedMoneyCell({
  value,
}: {
  value: string | null | undefined;
}) {
  const numeric = value == null ? Number.NaN : Number(value);

  return (
    <span className="flex min-w-0 items-center justify-end gap-(--space-2)">
      <span
        className={cn(
          "truncate font-mono tabular-nums",
          !Number.isFinite(numeric) && "text-[var(--color-ink-faint)]",
        )}
      >
        {Number.isFinite(numeric) ? numeric.toFixed(5) : "—"}
      </span>
      <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
        USD
      </span>
    </span>
  );
}

interface BomEditorProps {
  initialRows?: BomPayloadRow[];
  availableComponents: AvailableComponent[];
  quantityHeader?: string;
  recipeBasis?: RecipeBasis;
  outputQuantity?: string | null;
  readOnly?: boolean;
  error?: unknown;
  onRowsChange?: (rows: BomPayloadRow[], meta: BomEditorChangeMeta) => void;
}

export function BomEditor({
  initialRows,
  availableComponents,
  quantityHeader = "Qty used",
  recipeBasis = "unit",
  outputQuantity = "1",
  readOnly = false,
  error,
  onRowsChange,
}: BomEditorProps) {
  const [initialGridRows] = useState(() => toGridRows(initialRows));
  const [initialComparable] = useState(() =>
    comparablePayload(toGridRows(initialRows))
  );
  const [rows, setRows] = useState<BomGridRow[]>(initialGridRows);
  const componentMap = useMemo(
    () => new Map(availableComponents.map((component) => [component.id, component])),
    [availableComponents]
  );
  const componentOptions = useMemo(
    () =>
      availableComponents.map((component) => ({
        ...component,
        unitName: component.unit,
      })),
    [availableComponents]
  );
  const errorState = useMemo(() => buildErrorState(error, rows), [error, rows]);

  const emitRowsChange = useCallback(
    (nextRows: BomGridRow[], change: EditableLineDataGridChange<BomGridRow>) => {
      setRows(nextRows);
      onRowsChange?.(toPayloadRows(nextRows), {
        dirty: comparablePayload(nextRows) !== initialComparable,
        change,
      });
    },
    [initialComparable, onRowsChange]
  );

  const getRowId = useCallback((row: BomGridRow) => row.clientRowId, []);
  const isBlankRow = useCallback((row: BomGridRow) => isBlankBomRow(row), []);
  const rowHasError = useCallback(
    (row: BomGridRow) => errorState.byRowId.has(row.clientRowId),
    [errorState]
  );
  const hasError = useCallback(
    (key: BomColumnKey) => (params: CellClassParams<BomGridRow>) =>
      hasCellError(errorState, params.data, key),
    [errorState]
  );
  const errorTooltip = useCallback(
    (key: BomColumnKey) => ({ data }: { data?: BomGridRow }) =>
      data ? (errorState.byRowId.get(data.clientRowId)?.get(key) ?? null) : null,
    [errorState]
  );

  const columns = useMemo<LineField<BomGridRow>[]>(
    () => {
      const nextColumns: LineField<BomGridRow>[] = [
        {
          field: "componentId",
          kind: "inventory-item",
          headerName: "Component",
          minWidth: 240,
          flex: 1.4,
          editable: !readOnly,
          options: componentOptions,
          placeholder: "Search items...",
          emptyMessage: "No items found",
          requiredMessage: "Component is required",
          isRowBlank: isBlankBomRow,
          getDraftRow: (row: BomGridRow, componentId: string) => ({
            ...row,
            componentId,
          }),
          showTypeBadge: true,
          createLinks: [
            {
              href: "/inventory/product",
              label: "Create product",
            },
            {
              href: "/inventory/material",
              label: "Create material",
            },
          ],
          getSecondaryText: (component) =>
            (component as AvailableComponent).unit,
          cellRenderer: (params: ICellRendererParams<BomGridRow>) => (
            <ComponentCell {...params} componentMap={componentMap} />
          ),
          cellClassRules: {
            "erp-editable-grid-cell-error": hasError("componentId"),
          },
          tooltipValueGetter: errorTooltip("componentId"),
        },
        {
          field: "quantity",
          kind: "number",
          headerName: quantityHeader,
          minWidth: 156,
          flex: 0.7,
          editable: !readOnly,
          getSuffix: (row) => getComponentUnit(row, componentMap),
          getValidationErrors: (value, row) => {
            const nextRow = {
              ...row,
              quantity: normalizeTextCell(value),
            };
            if (isBlankBomRow(nextRow)) {
              return null;
            }
            return isPositiveNumberString(nextRow.quantity ?? "")
              ? null
              : ["Quantity must be greater than 0"];
          },
          valueSetter: (params: ValueSetterParams<BomGridRow, string | null>) => {
            params.data.quantity = normalizeTextCell(params.newValue);
            return true;
          },
          cellRenderer: (params: ICellRendererParams<BomGridRow>) => (
            <QuantityCell {...params} componentMap={componentMap} />
          ),
          rightAligned: true,
          cellClassRules: {
            "erp-editable-grid-cell-error": hasError("quantity"),
          },
          tooltipValueGetter: errorTooltip("quantity"),
        },
        {
          colId: "estimatedContribution",
          kind: "display",
          headerName: "Cost",
          headerTooltip: BOM_ESTIMATED_CONTRIBUTION_TOOLTIP,
          minWidth: 152,
          flex: 0.8,
          rightAligned: true,
          cellRenderer: ({ data }: ICellRendererParams<BomGridRow>) => {
            const estimatedUnitCost = data?.componentId
              ? (componentMap.get(data.componentId)?.estimatedUnitCost ?? null)
              : null;
            const contribution = data
              ? calculateEstimatedComponentContribution({
                  quantity: data.quantity,
                  estimatedUnitCost,
                  recipeBasis,
                  outputQuantity,
                })
              : null;

            return <EstimatedMoneyCell value={contribution} />;
          },
        },
        {
          colId: "alternates",
          kind: "display",
          headerName: "Variants",
          minWidth: 128,
          flex: 0.6,
          cellRenderer: (params: ICellRendererParams<BomGridRow>) => (
            <VariantsCell
              {...params}
              rows={rows}
              componentMap={componentMap}
              emitRowsChange={emitRowsChange}
              readOnly={readOnly}
            />
          ),
        },
        {
          field: "minimumLotAgeDays",
          kind: "display",
          headerName: "Requirements",
          minWidth: 136,
          flex: 0.65,
          cellRenderer: (params: ICellRendererParams<BomGridRow>) => (
            <RequirementsCell
              {...params}
              rows={rows}
              emitRowsChange={emitRowsChange}
              readOnly={readOnly}
            />
          ),
          cellClassRules: {
            "erp-editable-grid-cell-error": hasError("minimumLotAgeDays"),
          },
          tooltipValueGetter: errorTooltip("minimumLotAgeDays"),
        },
      ];

      return nextColumns;
    },
    [
      componentMap,
      componentOptions,
      errorTooltip,
      emitRowsChange,
      hasError,
      outputQuantity,
      quantityHeader,
      readOnly,
      recipeBasis,
      rows,
    ]
  );

  return (
    <MutableLines
      rows={rows}
      fields={columns}
      getRowId={getRowId}
      createRow={() => createBlankGridRow()}
      onRowsChange={emitRowsChange}
      addLabel="Add ingredient"
      readOnly={readOnly}
      emptyMessage="No ingredients yet."
      isBlankRow={isBlankRow}
      rowHasError={rowHasError}
      error={errorState.gridError}
      defaultColDef={{
        cellClass: ({ data }) =>
          cn(data && isBlankBomRow(data) ? "muted" : undefined),
      }}
    />
  );
}

export type { BomPayloadRow };
