"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  SettingsBlock,
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings-panel";
import { apiJson } from "@/lib/client/api";

type LocationRow = {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  hasActivity?: boolean;
};

type LocationPayload = {
  name: string;
  code: string;
};

export function LocationsSection({
  initialLocations,
  multiLocationLocked,
}: {
  initialLocations: LocationRow[];
  multiLocationLocked: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<LocationRow[]>(initialLocations);
  const savingDraftIdsRef = useRef(new Set<string>());
  const mutation = useMutation({
    mutationFn: async ({ row }: { row: LocationRow }) => {
      const payload = toPayload(row);
      if (!payload) return null;
      if (isDraftRow(row)) {
        return apiJson<LocationRow>("/api/locations", {
          method: "POST",
          body: payload,
          fallbackError: "Failed to create location.",
        });
      }
      return apiJson<LocationRow>(`/api/locations/${row.id}`, {
        method: "PATCH",
        body: payload,
        fallbackError: "Failed to update location.",
      });
    },
    onSuccess: (saved, variables) => {
      if (!saved) return;
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.id === variables.row.id
            ? { ...saved, hasActivity: variables.row.hasActivity ?? false }
            : row,
        ),
      );
    },
    onSettled: (_saved, _error, variables) => {
      savingDraftIdsRef.current.delete(variables.row.id);
    },
  });
  const makeDefaultMutation = useMutation({
    mutationFn: (row: LocationRow) =>
      apiJson<LocationRow>(`/api/locations/${row.id}`, {
        method: "PATCH",
        body: { isDefault: true },
        fallbackError: "Failed to change the default location.",
      }),
    onSuccess: (saved) => {
      setRows((currentRows) =>
        currentRows.map((row) => ({ ...row, isDefault: row.id === saved.id })),
      );
      router.refresh();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (row: LocationRow) =>
      isDraftRow(row)
        ? Promise.resolve({ success: true })
        : apiJson<{ success: boolean }>(`/api/locations/${row.id}`, {
            method: "DELETE",
            fallbackError: "Failed to delete location.",
          }),
    onSuccess: (_result, row) => {
      setRows((currentRows) => currentRows.filter((current) => current.id !== row.id));
      router.refresh();
    },
  });

  const makeDefault = makeDefaultMutation.mutate;
  const fields = useMemo<LineField<LocationRow>[]>(
    () => [
      {
        field: "name",
        kind: "text",
        headerName: "Location name",
        flex: 1,
        minWidth: 220,
        editable: true,
      },
      {
        field: "code",
        kind: "text",
        headerName: "Code",
        width: 160,
        mono: true,
        editable: true,
      },
      {
        colId: "default",
        kind: "display",
        headerName: "Default",
        width: 160,
        cellRenderer: (params: ICellRendererParams<LocationRow>) => {
          const row = params.data;
          if (!row || isDraftRow(row)) return null;
          if (row.isDefault) {
            return <Badge variant="secondary">Default</Badge>;
          }
          return (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => makeDefault(row)}
            >
              Make default
            </Button>
          );
        },
      },
    ],
    [makeDefault],
  );
  const saveStatus =
    mutation.isPending || makeDefaultMutation.isPending || deleteMutation.isPending
      ? "Saving..."
      : mutation.isError || makeDefaultMutation.isError || deleteMutation.isError
        ? "Changes not saved"
        : "All changes saved";
  const actionError =
    mutation.error instanceof Error
      ? mutation.error.message
      : makeDefaultMutation.error instanceof Error
        ? makeDefaultMutation.error.message
        : deleteMutation.error instanceof Error
          ? deleteMutation.error.message
          : null;

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Locations"
        sub="Places stock is stored. Stock moves between locations via transfers."
        action={
          <span className="text-[length:var(--text-xs)] text-muted-foreground">
            {saveStatus}
          </span>
        }
      />

      <SettingsCard>
        <SettingsBlock title="Locations" count={rows.length}>
          <MutableLines<LocationRow>
            rows={rows}
            fields={fields}
            getRowId={(row) => row.id}
            createRow={() => ({
              id: `draft-${crypto.randomUUID()}`,
              name: "",
              code: "",
              isDefault: false,
            })}
            onRowsChange={(
              nextRows: LocationRow[],
              change: EditableLineDataGridChange<LocationRow>,
            ) => {
              setRows(nextRows);
              if (change.type !== "cell_edit_committed" || !change.row) return;
              const row = change.row;
              if (!toPayload(row)) return;
              if (isDraftRow(row) && savingDraftIdsRef.current.has(row.id)) return;
              if (isDraftRow(row)) savingDraftIdsRef.current.add(row.id);
              mutation.mutate({ row });
            }}
            addLabel="Add location"
            enableAddRow={!multiLocationLocked}
            initializeBlankRow={false}
            enableReorder={false}
            getDeleteDisabledReason={(row) =>
              row.isDefault
                ? "The default location cannot be deleted."
                : row.hasActivity
                  ? "This location has inventory activity and cannot be deleted."
                  : null
            }
            onDeleteRow={async (row) => {
              if (!isDraftRow(row)) {
                const confirmed = window.confirm(
                  `Delete ${row.name || "this location"}?`,
                );
                if (!confirmed) return;
              }
              await deleteMutation.mutateAsync(row);
            }}
            emptyMessage="No locations yet."
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

function isDraftRow(row: LocationRow) {
  return row.id.startsWith("draft-");
}

function toPayload(row: LocationRow): LocationPayload | null {
  const name = row.name.trim();
  const code = row.code.trim();
  if (!name || !code) return null;
  return { name, code };
}
