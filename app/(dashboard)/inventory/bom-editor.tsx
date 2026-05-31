"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  CellClassParams,
  ICellRendererParams,
  ValueSetterParams,
} from "ag-grid-community";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import { InsetPanel } from "@/components/inset-panel";
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
import { isPositiveNumberString } from "@/lib/schemas/shared";
import { cn } from "@/lib/utils";

type AvailableComponent = {
  id: string;
  name: string;
  displayName: string;
  itemType: string;
  unit: string;
};

type BomPayloadRow = {
  componentId: string | null;
  quantity: string | null;
  minimumLotAgeDays?: string | number | null;
  alternates?: Array<{ itemId: string }>;
};

type BomGridRow = BomPayloadRow & {
  clientRowId: string;
};

type BomColumnKey =
  | "componentId"
  | "quantity"
  | "minimumLotAgeDays"
  | "alternates";

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
  alternates: [],
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
      alternates: row.alternates ?? [],
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
        alternates: row.alternates ?? [],
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
      const match = /^bom\.(\d+)\.(componentId|quantity|minimumLotAgeDays|alternates)$/.exec(
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
      "alternates",
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
    return <span className="text-muted-foreground">Search items...</span>;
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

function RequirementsCell(params: ICellRendererParams<BomGridRow>) {
  const { data, node } = params;
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
            summary === "None" && "text-muted-foreground"
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
              className="text-[length:var(--text-xs)] text-muted-foreground"
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
              <span className="text-[length:var(--text-sm)] text-muted-foreground">
                days
              </span>
            </div>
            <p className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-muted-foreground">
              Lots are eligible when their received date is at least this many days old.
            </p>
            {enabled && !hasDayError && draftDays.trim() !== "" ? (
              <p className="text-[length:var(--text-xs)] text-muted-foreground">
                {formatMinimumLotAgeRequirementLabel(Number(draftDays))}
              </p>
            ) : null}
            {hasDayError ? (
              <p className="text-[length:var(--text-xs)] text-destructive">
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
              node.setDataValue(
                "minimumLotAgeDays",
                enabled ? normalizeMinimumLotAge(draftDays) : null
              );
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

function summarizeAlternates(row: BomGridRow | undefined) {
  const count = row?.alternates?.length ?? 0;
  if (count === 0) return "None";
  return `${count} alt${count === 1 ? "" : "s"}`;
}

function AlternatesCell({
  data,
  node,
  componentMap,
  options,
}: ICellRendererParams<BomGridRow> & {
  componentMap: Map<string, AvailableComponent>;
  options: Array<AvailableComponent & { unitName: string }>;
}) {
  const [open, setOpen] = useState(false);
  if (!data) {
    return null;
  }

  const alternates = data.alternates ?? [];
  const alternateIds = new Set(alternates.map((alternate) => alternate.itemId));
  const availableAlternates = options.filter(
    (option) => option.id !== data.componentId && !alternateIds.has(option.id)
  );

  const updateAlternates = (nextAlternates: Array<{ itemId: string }>) => {
    node.setDataValue("alternates", nextAlternates);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-full w-full justify-start px-(--space-3)",
            alternates.length === 0 && "text-muted-foreground"
          )}
        >
          {summarizeAlternates(data)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Alternates</PopoverTitle>
          <PopoverDescription>
            Approved substitute components for this line.
          </PopoverDescription>
        </PopoverHeader>
        <div className="space-y-(--space-3)">
          {alternates.length > 0 ? (
            <div className="space-y-(--space-2)">
              {alternates.map((alternate) => {
                const item = componentMap.get(alternate.itemId);
                return (
                  <InsetPanel
                    key={alternate.itemId}
                    className="flex min-w-0 items-center justify-between gap-(--space-3) px-(--space-4) py-(--space-2)"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[length:var(--text-sm)] font-medium">
                        {item?.displayName ?? item?.name ?? alternate.itemId}
                      </p>
                      <p className="truncate text-[length:var(--text-xs)] text-muted-foreground">
                        {item?.unit ?? "Unit unavailable"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${item?.name ?? "alternate"}`}
                      onClick={() =>
                        updateAlternates(
                          alternates.filter(
                            (entry) => entry.itemId !== alternate.itemId
                          )
                        )
                      }
                    >
                      <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                    </Button>
                  </InsetPanel>
                );
              })}
            </div>
          ) : (
            <p className="text-[length:var(--text-sm)] text-muted-foreground">
              No alternates.
            </p>
          )}
          <InventoryItemCombobox
            options={availableAlternates}
            value={null}
            onValueChange={(itemId) => {
              if (!itemId) return;
              updateAlternates([...alternates, { itemId }]);
            }}
            placeholder="Add alternate..."
            emptyMessage="No compatible options"
            inputAriaInvalid={false}
            inputClassName="h-(--height-input-sm)"
            contentClassName="w-[min(28rem,calc(100vw-2rem))]"
            showTypeBadge
            getSecondaryText={(component) => component.unit}
          />
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
        <span className="ml-auto truncate text-muted-foreground">{unit}</span>
      ) : null}
    </span>
  );
}

interface BomEditorProps {
  initialRows?: BomPayloadRow[];
  availableComponents: AvailableComponent[];
  quantityHeader?: string;
  error?: unknown;
  onRowsChange?: (rows: BomPayloadRow[], meta: BomEditorChangeMeta) => void;
}

export function BomEditor({
  initialRows,
  availableComponents,
  quantityHeader = "Qty used",
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
        editable: true,
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
        editable: true,
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
        field: "minimumLotAgeDays",
        kind: "display",
        headerName: "Requirements",
        minWidth: 136,
        flex: 0.65,
        cellRenderer: RequirementsCell,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("minimumLotAgeDays"),
        },
        tooltipValueGetter: errorTooltip("minimumLotAgeDays"),
      },
      {
        field: "alternates",
        kind: "display",
        headerName: "Alternates",
        minWidth: 116,
        flex: 0.55,
        valueFormatter: (params) => summarizeAlternates(params.data),
        cellRenderer: (params: ICellRendererParams<BomGridRow>) => (
          <AlternatesCell
            {...params}
            componentMap={componentMap}
            options={componentOptions}
          />
        ),
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("alternates"),
        },
        tooltipValueGetter: errorTooltip("alternates"),
      },
      ];

      return nextColumns;
    },
    [
      componentMap,
      componentOptions,
      errorTooltip,
      hasError,
      quantityHeader,
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
