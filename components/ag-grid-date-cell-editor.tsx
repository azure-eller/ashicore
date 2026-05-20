"use client";

import { type CustomCellEditorProps } from "ag-grid-react";
import { DatePicker } from "@/components/ui/date-picker";

/**
 * AG Grid cell editor backed by the shadcn DatePicker, so date columns in
 * EditableLineDataGrid / ERPDataGrid get a real calendar picker instead of a
 * raw text field. Stores/returns the canonical `YYYY-MM-DD` business-date
 * string (or null when cleared). The column's valueSetter receives the picked
 * value as `params.newValue`.
 */
export function AgGridDateCellEditor(
  props: CustomCellEditorProps<unknown, string | null>,
) {
  return (
    <div className="flex h-full w-full items-center">
      <DatePicker
        value={props.value ?? ""}
        onChange={(next) => {
          const normalized = next && next.trim() !== "" ? next : null;
          props.onValueChange(normalized);
          props.stopEditing();
        }}
        className="h-full w-full border-0 bg-transparent shadow-none"
      />
    </div>
  );
}
