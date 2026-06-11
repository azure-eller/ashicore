"use client";

import { useCallback, useMemo } from "react";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  StarIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import {
  CardSection,
} from "@/components/card-page/card-page";
import { cn } from "@/lib/utils";
import type {
  CustomerContactRole,
  CustomerContactRow,
} from "@/lib/sales/types";
import styles from "@/components/card-page/card-page.module.css";

import {
  replaceRow,
  useSyncedRows,
  type ContactGridRow,
} from "./customer-draft";


export function ContactsSection({
  rows: sourceRows,
  onOpenStream,
  readOnly,
  onSave,
  onDelete,
}: {
  rows: CustomerContactRow[];
  readOnly: boolean;
  onOpenStream: (contact: { id: string; name: string }) => void;
  onSave: (row: ContactGridRow) => void;
  onDelete: (contactId: string) => void;
}) {
  const [rows, setRows] = useSyncedRows<ContactGridRow>(sourceRows);

  const columns = useMemo<LineField<ContactGridRow>[]>(
    () => [
      {
        colId: "primary",
        kind: "display",
        headerName: "Primary",
        width: 92,
        minWidth: 92,
        cellRenderer: (params: ICellRendererParams<ContactGridRow>) => {
          const row = params.data;
          if (!row) return null;
          const active = row.roles.includes("primary");
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={readOnly}
              aria-pressed={active}
              aria-label={active ? "Primary contact" : "Set primary contact"}
              title={active ? "Primary contact" : "Set primary contact"}
              className={styles.primaryContactButton}
              onClick={() => {
                const next = {
                  ...row,
                  roles: active
                    ? row.roles.filter((role) => role !== "primary")
                    : [...new Set([...row.roles, "primary"])] as CustomerContactRole[],
                };
                setRows((current) => replaceRow(current, next));
                if (next.name.trim()) onSave(next);
              }}
            >
              <HugeiconsIcon
                icon={StarIcon}
                className={cn(active && styles.primaryContactIconActive)}
              />
            </Button>
          );
        },
      },
      {
        ...textColumn<ContactGridRow>("name", "Name", !readOnly),
        cellRenderer: (params: ICellRendererParams<ContactGridRow>) => {
          const row = params.data;
          if (!row) return null;
          if (row.isNew || !row.name.trim()) return row.name ?? "";
          return (
            <button
              type="button"
              className="font-medium text-[var(--color-ink)] hover:underline"
              aria-label={`View activity for "${row.name}"`}
              onClick={() => onOpenStream({ id: row.id, name: row.name })}
            >
              {row.name}
            </button>
          );
        },
      },
      textColumn("title", "Role", !readOnly),
      textColumn("email", "Email", !readOnly),
      textColumn("phone", "Phone", !readOnly),
    ],
    [onOpenStream, onSave, readOnly, setRows]
  );

  const onRowsChange = useCallback(
    (nextRows: ContactGridRow[], change: EditableLineDataGridChange<ContactGridRow>) => {
      setRows(nextRows);
      if (change.type === "row_deleted" && change.row && !change.row.isNew) {
        onDelete(change.row.id);
        return;
      }
      if (
        change.type === "cell_edit_committed" &&
        change.row?.name.trim()
      ) {
        onSave(change.row);
      }
    },
    [onDelete, onSave, setRows]
  );

  return (
    <CardSection title="Contacts" count={`· ${sourceRows.length}`}>
      <MutableLines
        rows={rows}
        fields={columns}
        getRowId={(row) => row.id}
        createRow={newContactRow}
        onRowsChange={onRowsChange}
        addLabel="Add contact"
        readOnly={readOnly}
        emptyMessage="No contacts yet."
      />
    </CardSection>
  );
}


function textColumn<TData>(
  field: keyof TData & string,
  headerName: string,
  editable: boolean,
  flex = 1
): LineField<TData> {
  return {
    field,
    kind: "text",
    headerName,
    editable,
    flex,
    minWidth: 120,
    valueSetter: (params: ValueSetterParams<TData>) => {
      if (!params.data) return false;
      const next =
        typeof params.newValue === "string"
          ? params.newValue.trim() || null
          : params.newValue;
      const data = params.data as Record<string, unknown>;
      const current = data[field] ?? null;
      if (next === current) return false;
      data[field] = next;
      return true;
    },
  };
}


function newContactRow(): ContactGridRow {
  const now = new Date();
  return {
    id: `new-${crypto.randomUUID()}`,
    isNew: true,
    name: "",
    title: null,
    email: null,
    phone: null,
    addressEntryId: null,
    roles: [],
    createdAt: now,
    updatedAt: now,
  };
}

