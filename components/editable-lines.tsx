"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CellClassParams,
  ColDef,
  GridReadyEvent,
  ValueFormatterParams,
  ValueGetterParams,
  ValueSetterParams,
} from "ag-grid-community";
import type { CustomCellEditorProps } from "ag-grid-react";
import { useGridCellEditor } from "ag-grid-react";

import {
  EditableLineDataGrid,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import {
  InventoryItemCombobox,
  type InventoryItemComboboxOption,
} from "@/components/inventory-item-combobox";
import type { ComboboxCreateLink } from "@/components/combobox-create-links";
import { Input } from "@/components/ui/input";
import { AgGridDateCellEditor } from "@/components/ag-grid-date-cell-editor";

type GetRowId<TData> = (row: TData) => string;
type RowsChange<TData> = (
  rows: TData[],
  change: EditableLineDataGridChange<TData>,
) => void;

type LineFieldBase<TData> = {
  kind?: "text" | "number" | "select" | "date" | "inventory-item" | "display";
  field?: keyof TData & string;
  colId?: string;
  headerName: string;
  headerTooltip?: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
  sortable?: boolean;
  autoHeight?: boolean;
  rightAligned?: boolean;
  mono?: boolean;
  muted?: boolean;
  strong?: boolean;
  editable?: boolean | ((row: TData | undefined) => boolean);
  editableParams?: ColDef<TData>["editable"];
  cellClass?: string | ((params: CellClassParams<TData>) => string | string[] | null | undefined);
  cellClassRules?: ColDef<TData>["cellClassRules"];
  tooltipValueGetter?: ColDef<TData>["tooltipValueGetter"];
  valueGetter?: (params: ValueGetterParams<TData>) => unknown;
  valueFormatter?: (params: ValueFormatterParams<TData>) => string;
  valueSetter?: (params: ValueSetterParams<TData>) => boolean;
  cellRenderer?: ColDef<TData>["cellRenderer"];
  values?: string[];
  getSelectLabel?: (value: string) => string;
  options?: InventoryItemComboboxOption[];
  placeholder?: string;
  emptyMessage?: string;
  requiredMessage?: string;
  getValidationErrors?: (value: string | null | undefined, row: TData) => string[] | null;
  getSuffix?: (row: TData) => string | null;
  isRowBlank?: (row: TData) => boolean;
  getDraftRow?: (row: TData, itemId: string) => TData;
  createLinks?: ComboboxCreateLink[];
  showTypeBadge?: boolean;
  getSecondaryText?: (option: InventoryItemComboboxOption) => string | null;
};

export type LineField<TData> = LineFieldBase<TData>;

type SharedLinesProps<TData> = {
  rows: TData[];
  fields: LineField<TData>[];
  getRowId: GetRowId<TData>;
  onRowsChange: RowsChange<TData>;
  emptyMessage?: string;
  rowHasError?: (row: TData) => boolean;
  error?: string | null;
  className?: string;
  defaultColDef?: ColDef<TData>;
  onGridReady?: (event: GridReadyEvent<TData>) => void;
};

const allowedCustomCellEditors = new Set<unknown>();

function editableValue<TData>(editable: LineFieldBase<TData>["editable"]): ColDef<TData>["editable"] {
  if (typeof editable === "function") {
    return ({ data }) => editable(data);
  }
  return editable ?? false;
}

function classNameFor<TData>(field: LineField<TData>): ColDef<TData>["cellClass"] {
  const staticClasses = [
    field.rightAligned ? "text-right" : null,
    field.mono ? "font-mono tabular-nums" : null,
    field.muted ? "text-muted-foreground" : null,
    field.strong ? "font-semibold" : null,
  ].filter(Boolean).join(" ");

  if (!field.cellClass) return staticClasses || undefined;
  if (typeof field.cellClass === "string") {
    return [staticClasses, field.cellClass].filter(Boolean).join(" ");
  }
  return (params) => {
    const dynamic = field.cellClass && typeof field.cellClass === "function"
      ? field.cellClass(params)
      : null;
    return [staticClasses, dynamic].flat().filter(Boolean) as string[];
  };
}

function buildLineColumns<TData>(fields: LineField<TData>[]): ColDef<TData>[] {
  return fields.map((field) => {
    const base: ColDef<TData> = {
      field: field.field as ColDef<TData>["field"],
      colId: field.colId,
      headerName: field.headerName,
      headerTooltip: field.headerTooltip,
      width: field.width,
      minWidth: field.minWidth,
      maxWidth: field.maxWidth,
      flex: field.flex,
      sortable: field.sortable,
      autoHeight: field.autoHeight,
      type: field.rightAligned ? "rightAligned" : undefined,
      editable: field.editableParams ?? editableValue(field.editable),
      cellClass: classNameFor(field),
      cellClassRules: field.cellClassRules,
      tooltipValueGetter: field.tooltipValueGetter,
      valueGetter: field.valueGetter,
      valueFormatter: field.valueFormatter,
      valueSetter: field.valueSetter,
      cellRenderer: field.cellRenderer,
    };

    const kind = field.kind ?? (field.editable ? "text" : "display");

    if (kind === "text" || kind === "number") {
      return {
        ...base,
        cellEditor: TextLineCellEditor,
        cellEditorParams: {
          getValidationErrorsForValue: (
            value: string | null,
            row: TData,
          ) => field.getValidationErrors?.(value, row) ?? null,
          getSuffix: field.getSuffix,
        },
      };
    }
    if (kind === "select") {
      return {
        ...base,
        cellEditor: SelectLineCellEditor,
        cellEditorParams: {
          values: field.values ?? [],
          getSelectLabel: field.getSelectLabel,
        },
      };
    }
    if (kind === "date") {
      return {
        ...base,
        cellEditor: AgGridDateCellEditor,
        cellEditorPopup: true,
      };
    }
    if (kind === "inventory-item") {
      return {
        ...base,
        cellEditor: InventoryItemLineCellEditor,
        cellEditorParams: {
          options: field.options ?? [],
          placeholder: field.placeholder ?? "Search...",
          emptyMessage: field.emptyMessage ?? "No results found",
          requiredMessage: field.requiredMessage ?? "Selection is required",
          isRowBlank: field.isRowBlank,
          getDraftRow: field.getDraftRow,
          createLinks: field.createLinks,
          showTypeBadge: field.showTypeBadge,
          getSecondaryText: field.getSecondaryText,
        },
      };
    }
    return {
      ...base,
      editable: false,
    };
  });
}

function assertAllowedLineColumns<TData>(columns: ColDef<TData>[]) {
  if (process.env.NODE_ENV === "production") return;
  for (const column of columns) {
    const editor = column.cellEditor;
    if (!editor || typeof editor === "string") continue;
    if (allowedCustomCellEditors.has(editor)) continue;
    const label = column.headerName ?? column.field ?? column.colId ?? "unknown";
    throw new Error(
      `Named line wrappers only allow shared line cell editors. Column "${String(label)}" uses a page-local custom cellEditor. Promote it to components/editable-lines.tsx or use raw EditableLineDataGrid for a custom workflow grid.`,
    );
  }
}

type MutableLinesProps<TData> = SharedLinesProps<TData> & {
  createRow: () => TData;
  addLabel: string;
  readOnly?: boolean;
  addDisabledReason?: string | null;
  /** Deprecated compatibility prop. Blank-row auto-add behavior is disabled. */
  isBlankRow?: (row: TData) => boolean;
  canDeleteRow?: (row: TData, rows: TData[]) => boolean;
  getDeleteDisabledReason?: (row: TData, rows: TData[]) => string | null;
  onDeleteRow?: (row: TData, rows: TData[]) => void | Promise<void>;
  onAddRow?: () => TData | null | Promise<TData | null>;
  initializeBlankRow?: boolean;
};

export function MutableLines<TData>({
  readOnly = false,
  rows: sourceRows,
  createRow,
  fields,
  initializeBlankRow = true,
  isBlankRow: _isBlankRow,
  ...props
}: MutableLinesProps<TData>) {
  void _isBlankRow;
  const columns = useMemo(() => buildLineColumns(fields), [fields]);
  assertAllowedLineColumns(columns);

  return (
    <EditableLineDataGrid
      {...props}
      columns={columns}
      rows={sourceRows}
      createRow={createRow}
      rowHeight={42}
      initializeBlankRow={initializeBlankRow}
      enableAddRow={!readOnly}
      enableReorder={!readOnly}
      enableDelete={!readOnly}
    />
  );
}

type ManagedEditableLinesProps<TData> = SharedLinesProps<TData> & {
  createRow: () => TData;
  editable?: boolean;
  canDeleteRow?: (row: TData, rows: TData[]) => boolean;
  getDeleteDisabledReason?: (row: TData, rows: TData[]) => string | null;
  onDeleteRow?: (row: TData, rows: TData[]) => void | Promise<void>;
};

export function ManagedEditableLines<TData>({
  editable = true,
  fields,
  ...props
}: ManagedEditableLinesProps<TData>) {
  const columns = useMemo(() => buildLineColumns(fields), [fields]);
  assertAllowedLineColumns(columns);
  return (
    <EditableLineDataGrid
      {...props}
      columns={columns}
      addLabel="Add row"
      rowHeight={42}
      enableAddRow={false}
      enableReorder={editable}
      enableDelete={editable}
    />
  );
}

type FixedEditableLinesProps<TData> = SharedLinesProps<TData> & {
  createRow: () => TData;
};

export function FixedEditableLines<TData>({ fields, ...props }: FixedEditableLinesProps<TData>) {
  const columns = useMemo(() => buildLineColumns(fields), [fields]);
  assertAllowedLineColumns(columns);
  return (
    <EditableLineDataGrid
      {...props}
      columns={columns}
      addLabel="Add row"
      rowHeight={42}
      enableAddRow={false}
      enableReorder={false}
      enableDelete={false}
    />
  );
}

type ReadOnlyLinesProps<TData> = Omit<SharedLinesProps<TData>, "onRowsChange"> & {
  createRow?: () => TData;
};

export function ReadOnlyLines<TData>({
  fields,
  createRow,
  ...props
}: ReadOnlyLinesProps<TData>) {
  const columns = useMemo(() => buildLineColumns(fields), [fields]);
  assertAllowedLineColumns(columns);
  const readOnlyColumns = useMemo(
    () => columns.map((column) => ({ ...column, editable: false })),
    [columns],
  );

  return (
    <EditableLineDataGrid
      {...props}
      columns={readOnlyColumns}
      createRow={createRow ?? (() => props.rows[0] as TData)}
      onRowsChange={() => undefined}
      addLabel="Add row"
      rowHeight={42}
      enableAddRow={false}
      enableReorder={false}
      enableDelete={false}
    />
  );
}

type InventoryItemLineCellEditorProps<TData, TOption extends InventoryItemComboboxOption> =
  CustomCellEditorProps<TData, string | null> & {
    options: TOption[];
    placeholder: string;
    emptyMessage: string;
    requiredMessage: string;
    isRowBlank?: (row: TData) => boolean;
    getDraftRow?: (row: TData, itemId: string) => TData;
    createLinks?: ComboboxCreateLink[];
    showTypeBadge?: boolean;
    getSecondaryText?: (option: TOption) => string | null;
  };

export function InventoryItemLineCellEditor<
  TData,
  TOption extends InventoryItemComboboxOption,
>(props: InventoryItemLineCellEditorProps<TData, TOption>) {
  const editorRef = useRef<HTMLDivElement>(null);
  const stopEditingFrameRef = useRef<number | null>(null);
  const valueRef = useRef<string | null>(props.value ?? null);
  const [value, setValue] = useState(props.value ?? "");

  useEffect(() => {
    return () => {
      if (stopEditingFrameRef.current != null) {
        window.cancelAnimationFrame(stopEditingFrameRef.current);
      }
    };
  }, []);

  useGridCellEditor({
    getValidationElement: () => editorRef.current ?? props.eGridCell,
    getValidationErrors: () => {
      const value = valueRef.current ?? "";
      const draftRow = props.getDraftRow?.(props.data, value) ?? props.data;
      if (props.isRowBlank?.(draftRow)) return null;
      return value ? null : [props.requiredMessage];
    },
  });

  return (
    <div ref={editorRef} className="flex h-full w-full items-center">
      <InventoryItemCombobox
        options={props.options}
        value={value}
        defaultOpen
        onValueChange={(id) => {
          const next = id ?? "";
          valueRef.current = next;
          setValue(next);
          props.onValueChange(next);
          if (next && stopEditingFrameRef.current == null) {
            // Popup selection can blur the grid before AG Grid's edit stop commits.
            // Write through the column valueSetter immediately so every wrapper sees the same committed row.
            props.node.setDataValue(props.column, next, "data");
            stopEditingFrameRef.current = window.requestAnimationFrame(() => {
              stopEditingFrameRef.current = null;
              props.stopEditing(true);
            });
          }
        }}
        inputAriaInvalid={false}
        inputClassName="h-full w-full min-w-0 border-0 bg-transparent shadow-none"
        placeholder={props.placeholder}
        emptyMessage={props.emptyMessage}
        contentClassName="w-[min(32rem,calc(100vw-2rem))]"
        createLinks={props.createLinks}
        showTypeBadge={props.showTypeBadge}
        getSecondaryText={props.getSecondaryText}
      />
    </div>
  );
}

type TextLineCellEditorProps<TData> = CustomCellEditorProps<TData, string | null> & {
  getSuffix?: (row: TData) => string | null;
  getValidationErrorsForValue?: (value: string | null, row: TData) => string[] | null;
};

type SelectLineCellEditorProps<TData> = CustomCellEditorProps<TData, string | null> & {
  values: string[];
  getSelectLabel?: (value: string) => string;
};

export function SelectLineCellEditor<TData>(props: SelectLineCellEditorProps<TData>) {
  const editorRef = useRef<HTMLSelectElement>(null);
  const [value, setValue] = useState(props.value ?? "");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useGridCellEditor({
    getValidationElement: () => editorRef.current ?? props.eGridCell,
  });

  return (
    <select
      ref={editorRef}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        props.onValueChange(next);
        props.stopEditing();
      }}
      className="h-full w-full min-w-0 border-0 bg-transparent px-0 shadow-none outline-none"
    >
      {props.values.map((option) => (
        <option key={option} value={option}>
          {props.getSelectLabel?.(option) ?? props.formatValue?.(option) ?? option}
        </option>
      ))}
    </select>
  );
}

export function TextLineCellEditor<TData>(props: TextLineCellEditorProps<TData>) {
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<string | null>(props.value ?? null);
  const [value, setValue] = useState(props.value ?? "");
  const suffix = props.getSuffix?.(props.data) ?? null;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useGridCellEditor({
    getValidationElement: () => editorRef.current ?? props.eGridCell,
    getValidationErrors: () =>
      props.getValidationErrorsForValue?.(valueRef.current, props.data) ?? null,
  });

  return (
    <div ref={editorRef} className="flex h-full w-full items-center gap-(--space-3)">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          valueRef.current = next;
          setValue(next);
          props.onValueChange(next);
        }}
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:shadow-none"
      />
      {suffix ? (
        <span className="shrink-0 truncate text-[length:var(--text-sm)] text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

allowedCustomCellEditors.add(InventoryItemLineCellEditor);
allowedCustomCellEditors.add(SelectLineCellEditor);
allowedCustomCellEditors.add(TextLineCellEditor);
allowedCustomCellEditors.add(AgGridDateCellEditor);

export type { ColDef, EditableLineDataGridChange };
