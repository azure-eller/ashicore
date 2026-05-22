"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  CellClassParams,
  ICellRendererParams,
  ValueSetterParams,
} from "ag-grid-community";
import type { CustomCellEditorProps } from "ag-grid-react";
import { useGridCellEditor } from "ag-grid-react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
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
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `bom-row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTextCell(value: unknown) {
  if (value == null) {
    return null;
  }

  const nextValue = String(value).trim();
  return nextValue === "" ? null : nextValue;
}

function normalizeMinimumLotAge(value: unknown) {
  if (value == null) {
    return null;
  }

  const nextValue = String(value).trim();
  return nextValue === "" ? null : nextValue;
}

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

function getNestedMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { message?: unknown; root?: unknown };
  if (typeof candidate.message === "string") {
    return candidate.message;
  }

  return getNestedMessage(candidate.root);
}

function buildErrorState(error: unknown, rows: BomGridRow[]): BomErrorState {
  const byRowId = new Map<string, Map<BomColumnKey, string>>();
  const gridMessages: string[] = [];
  const topLevelMessage = getNestedMessage(error);

  if (topLevelMessage) {
    gridMessages.push(topLevelMessage);
  }

  const rowErrors = Array.isArray(error) ? error : [];
  rowErrors.forEach((rowError, index) => {
    const row = rows[index];
    if (!row || !rowError || typeof rowError !== "object") {
      return;
    }

    const rowErrorObject = rowError as Record<string, unknown>;
    const rowMessages = new Map<BomColumnKey, string>();
    const keys: BomColumnKey[] = [
      "componentId",
      "quantity",
      "minimumLotAgeDays",
      "alternates",
    ];

    keys.forEach((key) => {
      const message = getNestedMessage(rowErrorObject[key]);
      if (message) {
        rowMessages.set(key, message);
      }
    });

    if (rowMessages.size > 0) {
      byRowId.set(row.clientRowId, rowMessages);
    }
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
                  <div
                    key={alternate.itemId}
                    className="flex min-w-0 items-center justify-between gap-(--space-3) border border-border px-(--space-4) py-(--space-2)"
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
                  </div>
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

function QuantityCellEditor(
  props: CustomCellEditorProps<BomGridRow, string | null> & {
    componentMap: Map<string, AvailableComponent>;
  }
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<string | null>(props.value ?? null);
  const [value, setValue] = useState(props.value ?? "");
  const unit = getComponentUnit(props.data, props.componentMap);

  useGridCellEditor({
    getValidationElement: () => editorRef.current ?? props.eGridCell,
    getValidationErrors: () => {
      const row = {
        ...props.data,
        quantity: normalizeTextCell(valueRef.current),
      };
      if (isBlankBomRow(row)) {
        return null;
      }

      const parsed = Number(row.quantity);
      return Number.isFinite(parsed) && parsed > 0
        ? null
        : ["Quantity must be greater than 0"];
    },
  });

  return (
    <div ref={editorRef} className="flex h-full w-full items-center gap-(--space-3)">
      <Input
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          valueRef.current = nextValue;
          setValue(nextValue);
          props.onValueChange(nextValue);
        }}
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:shadow-none"
      />
      {unit ? (
        <span className="shrink-0 truncate text-[length:var(--text-sm)] text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

function ComponentCellEditor(
  props: CustomCellEditorProps<BomGridRow, string | null> & {
    options: Array<AvailableComponent & { unitName: string }>;
  }
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<string | null>(props.value ?? null);

  useGridCellEditor({
    getValidationElement: () => editorRef.current ?? props.eGridCell,
    getValidationErrors: () => {
      const row = {
        ...props.data,
        componentId: valueRef.current ?? "",
      };
      if (isBlankBomRow(row)) {
        return null;
      }

      return valueRef.current ? null : ["Component is required"];
    },
  });

  return (
    <div ref={editorRef} className="flex h-full w-full items-center">
      <InventoryItemCombobox
        options={props.options}
        value={props.value ?? ""}
        defaultOpen
        onValueChange={(id) => {
          valueRef.current = id ?? "";
          props.onValueChange(id ?? "");
          if (id) {
            props.stopEditing(true);
          }
        }}
        inputAriaInvalid={false}
        inputClassName="h-full w-full min-w-0 border-0 bg-transparent shadow-none"
        placeholder="Search items..."
        emptyMessage="No items found"
        contentClassName="w-[min(32rem,calc(100vw-2rem))]"
        showTypeBadge
        createLinks={[
          {
            href: "/inventory/product",
            label: "Create product",
          },
          {
            href: "/inventory/material",
            label: "Create material",
          },
        ]}
        getSecondaryText={(component) => component.unit}
      />
    </div>
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

  const columns = useMemo<ColDef<BomGridRow>[]>(
    () => {
      const nextColumns: ColDef<BomGridRow>[] = [
        {
        field: "componentId",
        headerName: "Component",
        minWidth: 240,
        flex: 1.4,
        editable: true,
        cellEditor: ComponentCellEditor,
        cellEditorParams: {
          options: componentOptions,
        },
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
        headerName: quantityHeader,
        minWidth: 156,
        flex: 0.7,
        editable: true,
        cellEditor: QuantityCellEditor,
        cellEditorParams: {
          componentMap,
        },
        valueSetter: (params: ValueSetterParams<BomGridRow, string | null>) => {
          params.data.quantity = normalizeTextCell(params.newValue);
          return true;
        },
        cellRenderer: (params: ICellRendererParams<BomGridRow>) => (
          <QuantityCell {...params} componentMap={componentMap} />
        ),
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("quantity"),
        },
        tooltipValueGetter: errorTooltip("quantity"),
      },
      {
        field: "minimumLotAgeDays",
        headerName: "Requirements",
        minWidth: 136,
        flex: 0.65,
        editable: false,
        cellRenderer: RequirementsCell,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("minimumLotAgeDays"),
        },
        tooltipValueGetter: errorTooltip("minimumLotAgeDays"),
      },
      {
        field: "alternates",
        headerName: "Alternates",
        minWidth: 116,
        flex: 0.55,
        editable: false,
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
    <EditableLineDataGrid
      rows={rows}
      columns={columns}
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
