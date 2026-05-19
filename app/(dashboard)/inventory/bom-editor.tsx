"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  CellClassParams,
  ICellEditorParams,
  ICellRendererParams,
  ValueFormatterParams,
  ValueSetterParams,
} from "ag-grid-community";
import type { CustomCellEditorProps } from "ag-grid-react";
import { useGridCellEditor } from "ag-grid-react";

import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
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
  consumptionMode?: "per_output_unit" | "per_batch" | "per_group" | null;
  basisOutputQuantity?: string | null;
  batchScalingMode?: "proportional" | "full_batches_only" | null;
  groupRemainderPolicy?: "ask" | "leave_loose" | "create_partial_group" | null;
  minimumLotAgeDays?: string | number | null;
  alternates?: Array<{ itemId: string }>;
};

type BomGridRow = BomPayloadRow & {
  clientRowId: string;
};

type BomColumnKey =
  | "componentId"
  | "quantity"
  | "consumptionMode"
  | "basisOutputQuantity"
  | "scalingPolicy"
  | "minimumLotAgeDays";

type BomErrorState = {
  gridError: string | null;
  byRowId: Map<string, Map<BomColumnKey, string>>;
};

type BomEditorChangeMeta = {
  dirty: boolean;
  change: EditableLineDataGridChange<BomGridRow>;
};

const CONSUMPTION_MODE_LABELS = {
  per_output_unit: "Output unit",
  per_batch: "Batch",
  per_group: "Group",
} as const;

const BATCH_SCALING_LABELS = {
  proportional: "Proportional",
  full_batches_only: "Full batches only",
} as const;

const GROUP_REMAINDER_LABELS = {
  ask: "Ask",
  leave_loose: "Leave loose",
  create_partial_group: "Create partial group",
} as const;

const blankBomLine = {
  componentId: "",
  quantity: null,
  consumptionMode: "per_output_unit" as const,
  basisOutputQuantity: null,
  batchScalingMode: null,
  groupRemainderPolicy: null,
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
      consumptionMode: row.consumptionMode ?? "per_output_unit",
      alternates: row.alternates ?? [],
      clientRowId: createClientRowId(),
    })) ?? [];

  return gridRows.length > 0 ? gridRows : [createBlankGridRow()];
}

function toPayloadRows(rows: BomGridRow[]): BomPayloadRow[] {
  return rows.map((row) => ({
    componentId: row.componentId ?? "",
    quantity: normalizeTextCell(row.quantity),
    consumptionMode: row.consumptionMode ?? "per_output_unit",
    basisOutputQuantity: normalizeTextCell(row.basisOutputQuantity),
    batchScalingMode: row.batchScalingMode ?? null,
    groupRemainderPolicy: row.groupRemainderPolicy ?? null,
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
        consumptionMode: row.consumptionMode ?? "per_output_unit",
        basisOutputQuantity: row.basisOutputQuantity ?? null,
        batchScalingMode: row.batchScalingMode ?? null,
        groupRemainderPolicy: row.groupRemainderPolicy ?? null,
        minimumLotAgeDays: row.minimumLotAgeDays ?? null,
        alternates: row.alternates ?? [],
      }))
  );
}

function needsBasis(row: BomPayloadRow) {
  return row.consumptionMode === "per_batch" || row.consumptionMode === "per_group";
}

function scalingPolicyValue(row: BomPayloadRow) {
  if (row.consumptionMode === "per_batch") {
    return row.batchScalingMode ?? "proportional";
  }

  if (row.consumptionMode === "per_group") {
    return row.groupRemainderPolicy ?? "ask";
  }

  return null;
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
      "consumptionMode",
      "basisOutputQuantity",
      "scalingPolicy",
      "minimumLotAgeDays",
    ];

    keys.forEach((key) => {
      const sourceKey =
        key === "scalingPolicy"
          ? row.consumptionMode === "per_group"
            ? "groupRemainderPolicy"
            : "batchScalingMode"
          : key;
      const message = getNestedMessage(rowErrorObject[sourceKey]);
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

function applyConsumptionModeDefaults(
  row: BomGridRow,
  value: BomGridRow["consumptionMode"],
  typicalBatchSize?: string | null,
  typicalGroupSize?: string | null
) {
  row.consumptionMode = value ?? "per_output_unit";

  if (row.consumptionMode === "per_batch") {
    row.basisOutputQuantity = typicalBatchSize ?? null;
    row.batchScalingMode = "proportional";
    row.groupRemainderPolicy = null;
    return;
  }

  if (row.consumptionMode === "per_group") {
    row.basisOutputQuantity = typicalGroupSize ?? null;
    row.batchScalingMode = null;
    row.groupRemainderPolicy = "ask";
    return;
  }

  row.basisOutputQuantity = null;
  row.batchScalingMode = null;
  row.groupRemainderPolicy = null;
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

function ScalingPolicyCell({ data }: ICellRendererParams<BomGridRow>) {
  if (!data || data.consumptionMode === "per_output_unit") {
    return <span className="text-muted-foreground">—</span>;
  }

  if (data.consumptionMode === "per_batch") {
    return (
      <span>
        {BATCH_SCALING_LABELS[data.batchScalingMode ?? "proportional"]}
      </span>
    );
  }

  return (
    <span>{GROUP_REMAINDER_LABELS[data.groupRemainderPolicy ?? "ask"]}</span>
  );
}

function UnitCell({
  data,
  componentMap,
}: ICellRendererParams<BomGridRow> & {
  componentMap: Map<string, AvailableComponent>;
}) {
  return (
    <span className="text-muted-foreground">
      {data?.componentId ? (componentMap.get(data.componentId)?.unit ?? "—") : "—"}
    </span>
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
  typicalBatchSize?: string | null;
  typicalGroupSize?: string | null;
  error?: unknown;
  onRowsChange?: (rows: BomPayloadRow[], meta: BomEditorChangeMeta) => void;
}

export function BomEditor({
  initialRows,
  availableComponents,
  typicalBatchSize,
  typicalGroupSize,
  error,
  onRowsChange,
}: BomEditorProps) {
  const [initialGridRows] = useState(() => toGridRows(initialRows));
  const [initialComparable] = useState(() => comparablePayload(toGridRows(initialRows)));
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
        headerName: "Qty used",
        minWidth: 104,
        flex: 0.55,
        editable: true,
        cellEditor: "agTextCellEditor",
        valueSetter: (params: ValueSetterParams<BomGridRow, string | null>) => {
          params.data.quantity = normalizeTextCell(params.newValue);
          return true;
        },
        cellEditorParams: {
          getValidationErrors: ({
            value,
            cellEditorParams,
          }: {
            value: string | null | undefined;
            cellEditorParams: ICellEditorParams<BomGridRow>;
          }) => {
            const row = {
              ...cellEditorParams.data,
              quantity: normalizeTextCell(value),
            };
            if (isBlankBomRow(row)) {
              return null;
            }

            const parsed = Number(row.quantity);
            return Number.isFinite(parsed) && parsed > 0
              ? null
              : ["Quantity must be greater than 0"];
          },
        },
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("quantity"),
        },
        tooltipValueGetter: errorTooltip("quantity"),
      },
      {
        field: "consumptionMode",
        headerName: "Used per",
        minWidth: 136,
        flex: 0.7,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["per_output_unit", "per_batch", "per_group"],
        },
        valueSetter: (
          params: ValueSetterParams<BomGridRow, BomGridRow["consumptionMode"]>
        ) => {
          applyConsumptionModeDefaults(
            params.data,
            params.newValue,
            typicalBatchSize,
            typicalGroupSize
          );
          return true;
        },
        valueFormatter: ({
          value,
        }: ValueFormatterParams<BomGridRow, BomGridRow["consumptionMode"]>) =>
          CONSUMPTION_MODE_LABELS[value ?? "per_output_unit"],
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("consumptionMode"),
        },
        tooltipValueGetter: errorTooltip("consumptionMode"),
      },
      {
        field: "basisOutputQuantity",
        headerName: "Basis",
        minWidth: 108,
        flex: 0.55,
        editable: ({ data }) => (data ? needsBasis(data) : false),
        cellEditor: "agTextCellEditor",
        valueSetter: (params: ValueSetterParams<BomGridRow, string | null>) => {
          params.data.basisOutputQuantity = normalizeTextCell(params.newValue);
          return true;
        },
        valueFormatter: ({ data, value }) =>
          data && needsBasis(data) ? (value ?? "") : "—",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("basisOutputQuantity"),
          "erp-editable-grid-cell-muted": ({ data }) =>
            data ? !needsBasis(data) : false,
        },
        tooltipValueGetter: errorTooltip("basisOutputQuantity"),
      },
      {
        colId: "scalingPolicy",
        headerName: "Scaling / leftovers",
        minWidth: 152,
        flex: 0.8,
        editable: ({ data }) => Boolean(data && data.consumptionMode !== "per_output_unit"),
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          openEditorOnStart: true,
        },
        cellEditorSelector: ({ data }) => {
          if (data?.consumptionMode === "per_batch") {
            return {
              component: "agSelectCellEditor",
              params: { values: ["proportional", "full_batches_only"] },
            };
          }

          if (data?.consumptionMode === "per_group") {
            return {
              component: "agSelectCellEditor",
              params: { values: ["ask", "leave_loose", "create_partial_group"] },
            };
          }

          return undefined;
        },
        valueGetter: ({ data }) => (data ? scalingPolicyValue(data) : null),
        valueSetter: (params: ValueSetterParams<BomGridRow, string | null>) => {
          if (params.data.consumptionMode === "per_batch") {
            params.data.batchScalingMode =
              params.newValue === "full_batches_only"
                ? "full_batches_only"
                : "proportional";
            return true;
          }

          if (params.data.consumptionMode === "per_group") {
            params.data.groupRemainderPolicy =
              params.newValue === "leave_loose" ||
              params.newValue === "create_partial_group"
                ? params.newValue
                : "ask";
            return true;
          }

          return false;
        },
        cellRenderer: ScalingPolicyCell,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("scalingPolicy"),
          "erp-editable-grid-cell-muted": ({ data }) =>
            data ? data.consumptionMode === "per_output_unit" : false,
        },
        tooltipValueGetter: errorTooltip("scalingPolicy"),
      },
      {
        field: "minimumLotAgeDays",
        headerName: "Min Age",
        minWidth: 104,
        flex: 0.5,
        editable: true,
        cellEditor: "agTextCellEditor",
        valueSetter: (params: ValueSetterParams<BomGridRow, string | null>) => {
          params.data.minimumLotAgeDays = normalizeMinimumLotAge(params.newValue);
          return true;
        },
        cellEditorParams: {
          getValidationErrors: ({ value }: { value: string | null | undefined }) => {
            const normalized = normalizeMinimumLotAge(value);
            if (normalized == null) {
              return null;
            }

            return /^\d+$/.test(String(normalized)) && Number(normalized) >= 0
              ? null
              : ["Minimum lot age must be a whole number"];
          },
        },
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("minimumLotAgeDays"),
        },
        tooltipValueGetter: errorTooltip("minimumLotAgeDays"),
      },
      {
        colId: "unit",
        headerName: "Unit",
        minWidth: 92,
        flex: 0.45,
        cellRenderer: (params: ICellRendererParams<BomGridRow>) => (
          <UnitCell {...params} componentMap={componentMap} />
        ),
        },
      ];

      return nextColumns;
    },
    [
      componentMap,
      componentOptions,
      errorTooltip,
      hasError,
      typicalBatchSize,
      typicalGroupSize,
    ]
  );

  return (
    <EditableLineDataGrid
      rows={rows}
      columns={columns}
      getRowId={getRowId}
      createRow={createBlankGridRow}
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
