"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { FieldError } from "@/components/ui/field";
import { SettingsPanel, SettingsPanelHeader } from "@/components/settings-panel";
import { apiJson } from "@/lib/client/api";
import { formatCompactUnitLabel } from "@/lib/format";
import { getUomOptions } from "@/lib/units-of-measure";

type UnitRow = {
  id: string;
  name: string;
  size: string;
  uom: string;
};

type UnitPayload = {
  name: string;
  size: string;
  uom: string;
};

export function UnitsSection({ initialUnits }: { initialUnits: UnitRow[] }) {
  const [rows, setRows] = useState<UnitRow[]>(initialUnits);
  const savingDraftIdsRef = useRef(new Set<string>());
  const mutation = useMutation({
    mutationFn: async ({ row }: { row: UnitRow }) => {
      const payload = toPayload(row);
      if (!payload) return null;
      if (isDraftRow(row)) {
        return apiJson<UnitRow>("/api/units", {
          method: "POST",
          body: payload,
          fallbackError: "Failed to create unit.",
        });
      }
      return apiJson<UnitRow>(`/api/units/${row.id}`, {
        method: "PATCH",
        body: payload,
        fallbackError: "Failed to update unit.",
      });
    },
    onSuccess: (saved, variables) => {
      if (!saved) return;
      setRows((currentRows) =>
        currentRows.map((row) => (row.id === variables.row.id ? saved : row)),
      );
    },
    onSettled: (_saved, _error, variables) => {
      savingDraftIdsRef.current.delete(variables.row.id);
    },
  });

  const uomOptions = useMemo(
    () => getUomOptions().flatMap((group) => group.options),
    [],
  );
  const uomValues = useMemo(
    () => uomOptions.map((option) => option.value),
    [uomOptions],
  );
  const uomLabelByValue = useMemo(
    () => new Map(uomOptions.map((option) => [option.value, option.label])),
    [uomOptions],
  );
  const fields = useMemo<LineField<UnitRow>[]>(
    () => [
      {
        field: "name",
        kind: "text",
        headerName: "Unit name",
        flex: 1,
        minWidth: 220,
        editable: true,
      },
      {
        field: "size",
        kind: "number",
        headerName: "Size",
        width: 140,
        rightAligned: true,
        editable: true,
      },
      {
        field: "uom",
        kind: "select",
        headerName: "UOM",
        minWidth: 180,
        flex: 0.8,
        editable: true,
        values: uomValues,
        getSelectLabel: (value) => uomLabelByValue.get(value) ?? value,
      },
      {
        colId: "preview",
        kind: "display",
        headerName: "Preview",
        flex: 1,
        minWidth: 160,
        valueGetter: ({ data }) => data ? formatCompactUnitLabel(data) ?? "" : "",
      },
    ],
    [uomLabelByValue, uomValues],
  );
  const saveStatus = mutation.isPending
    ? "Saving..."
    : mutation.isError
      ? "Changes not saved"
      : "All changes saved";

  return (
    <SettingsPanel id="units">
      <SettingsPanelHeader
        title="Units"
        meta="Stocking and purchasing units available on item cards."
        action={
          <span className="text-[length:var(--text-xs)] text-muted-foreground">
            {saveStatus}
          </span>
        }
      />
      <div className="grid gap-(--space-4) p-(--space-8)">
        <MutableLines<UnitRow>
          rows={rows}
          fields={fields}
          getRowId={(row) => row.id}
          createRow={() => ({
            id: `draft-${crypto.randomUUID()}`,
            name: "",
            size: "1",
            uom: "ea",
          })}
          onRowsChange={(
            nextRows: UnitRow[],
            change: EditableLineDataGridChange<UnitRow>,
          ) => {
            setRows(nextRows);
            if (change.type !== "cell_edit_committed" || !change.row) return;
            const row = change.row;
            if (!toPayload(row)) return;
            if (isDraftRow(row) && savingDraftIdsRef.current.has(row.id)) return;
            if (isDraftRow(row)) savingDraftIdsRef.current.add(row.id);
            mutation.mutate({ row });
          }}
          addLabel="Add row"
          initializeBlankRow={false}
          enableDelete={false}
          enableReorder={false}
          emptyMessage="No units yet."
        />
        {mutation.error ? (
          <FieldError>
            {mutation.error instanceof Error ? mutation.error.message : "Failed to save unit."}
          </FieldError>
        ) : null}
      </div>
    </SettingsPanel>
  );
}

function isDraftRow(row: UnitRow) {
  return row.id.startsWith("draft-");
}

function toPayload(row: UnitRow): UnitPayload | null {
  const name = row.name.trim();
  const size = row.size.trim();
  const uom = row.uom.trim();
  if (!name || !size || !uom) return null;
  return { name, size, uom };
}
