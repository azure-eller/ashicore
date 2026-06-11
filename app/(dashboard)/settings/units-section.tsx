"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SettingsBlock,
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings-panel";
import { apiJson } from "@/lib/client/api";
import { formatCompactUnitLabel } from "@/lib/format";
import { getUomOptions } from "@/lib/units-of-measure";

type UnitRow = {
  id: string;
  name: string;
  size: string;
  uom: string;
  isInUse?: boolean;
};

type UnitPayload = {
  name: string;
  size: string;
  uom: string;
};

export function UnitsSection({ initialUnits }: { initialUnits: UnitRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<UnitRow[]>(initialUnits);
  const [searchValue, setSearchValue] = useState("");
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
        currentRows.map((row) =>
          row.id === variables.row.id
            ? { ...saved, isInUse: variables.row.isInUse ?? false }
            : row,
        ),
      );
    },
    onSettled: (_saved, _error, variables) => {
      savingDraftIdsRef.current.delete(variables.row.id);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (row: UnitRow) =>
      isDraftRow(row)
        ? Promise.resolve({ success: true })
        : apiJson<{ success: boolean }>(`/api/units/${row.id}`, {
            method: "DELETE",
            fallbackError: "Failed to delete unit.",
          }),
    onSuccess: (_result, row) => {
      setRows((currentRows) => currentRows.filter((current) => current.id !== row.id));
      router.refresh();
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
        headerName: "Shows as",
        flex: 1,
        minWidth: 160,
        valueGetter: ({ data }) => data ? formatCompactUnitLabel(data) ?? "" : "",
      },
    ],
    [uomLabelByValue, uomValues],
  );

  const query = searchValue.trim().toLowerCase();
  const shownRows = query
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(query) ||
          row.uom.toLowerCase().includes(query),
      )
    : rows;

  function handleRowsChange(
    nextRows: UnitRow[],
    change: EditableLineDataGridChange<UnitRow>,
  ) {
    setRows((currentRows) => {
      if (!query) return nextRows;
      // The grid only sees the filtered rows while searching; fold the change
      // back into the full set.
      switch (change.type) {
        case "row_added":
          return change.row ? [...currentRows, change.row] : currentRows;
        case "row_deleted":
          return change.row
            ? currentRows.filter((row) => row.id !== change.row!.id)
            : currentRows;
        default: {
          const byId = new Map(nextRows.map((row) => [row.id, row]));
          return currentRows.map((row) => byId.get(row.id) ?? row);
        }
      }
    });
    if (change.type !== "cell_edit_committed" || !change.row) return;
    const row = change.row;
    if (!toPayload(row)) return;
    if (isDraftRow(row) && savingDraftIdsRef.current.has(row.id)) return;
    if (isDraftRow(row)) savingDraftIdsRef.current.add(row.id);
    mutation.mutate({ row });
  }

  const actionError =
    mutation.error instanceof Error
      ? mutation.error.message
      : deleteMutation.error instanceof Error
        ? deleteMutation.error.message
        : null;

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Units"
        sub="Stocking and purchasing units available on item cards."
      />

      <SettingsCard>
        <SettingsBlock
          title="Units"
          count={rows.length}
          actions={
            <Input
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search units…"
              aria-label="Search units"
              className="h-(--height-input-sm) w-56 rounded-full"
            />
          }
        >
          <MutableLines<UnitRow>
            rows={shownRows}
            fields={fields}
            getRowId={(row) => row.id}
            createRow={() => ({
              id: `draft-${crypto.randomUUID()}`,
              name: "",
              size: "1",
              uom: "pcs",
            })}
            onRowsChange={handleRowsChange}
            addLabel="Add unit"
            initializeBlankRow={false}
            enableReorder={false}
            getDeleteDisabledReason={(row) =>
              row.isInUse ? "Unit is in use and cannot be deleted." : null
            }
            onDeleteRow={async (row) => {
              if (!isDraftRow(row)) {
                const confirmed = window.confirm(`Delete ${row.name || "this unit"}?`);
                if (!confirmed) return;
              }
              await deleteMutation.mutateAsync(row);
            }}
            emptyMessage={
              query ? `No units match “${searchValue}”.` : "No units yet."
            }
          />
          {actionError ? (
            <div className="mt-(--space-4)">
              <FieldError>{actionError}</FieldError>
            </div>
          ) : null}
        </SettingsBlock>
      </SettingsCard>
    </div>
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
