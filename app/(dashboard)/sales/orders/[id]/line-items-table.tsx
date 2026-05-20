"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ColDef,
  ICellRendererParams,
  ValueSetterParams,
} from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import {
  EditableLineDataGrid,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { patchSalesOrderLine } from "@/lib/api/clients/sales-orders";
import { cn } from "@/lib/utils";
import { formatPrice, formatQuantity, normalizeMoney } from "@/lib/format";
import type {
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderItemOption,
} from "@/app/(dashboard)/sales/types";
import { makeDraftLine, type OrderDraftController } from "./order-draft";
import cardStyles from "@/components/card-page/card-page.module.css";

export type LineItemsTableProps = {
  order: SalesOrderDetail;
  editable: boolean;
  itemOptions?: SalesOrderItemOption[];
  draft?: OrderDraftController;
  onAddLineItem?: (option: SalesOrderItemOption) => void;
  addingLine?: boolean;
  onDeleteLine?: (line: SalesOrderDetailLine) => Promise<void> | void;
  onReorderLines?: (orderedIds: string[]) => void;
  /** Draft-mode per-cell edit; live mode patches via the API directly. */
  onPatchLine?: (
    lineId: string,
    patch: { quantity?: string; unitPrice?: string },
  ) => void;
};

export function LineItemsTable({
  order,
  editable,
  itemOptions,
  draft,
  onAddLineItem,
  addingLine,
  onDeleteLine,
  onReorderLines,
  onPatchLine,
}: LineItemsTableProps) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<SalesOrderDetailLine | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  const totalQuantity = sumNumeric(order.lines.map((line) => line.quantity));
  const totalLineAmount = sumNumeric(order.lines.map((line) => line.lineTotal));
  const canAddLine = editable && (draft != null || onAddLineItem != null) && itemOptions != null;
  const existingItemIds = useMemo(
    () => new Set(order.lines.map((line) => line.itemId)),
    [order.lines],
  );

  // Live per-cell PATCH (draft mode short-circuits to onPatchLine).
  const patchMutation = useMutation({
    mutationKey: ["sales-order", order.id, "patch", "line-cell"],
    mutationFn: ({
      lineId,
      patch,
    }: {
      lineId: string;
      patch: { quantity?: string; unitPrice?: string };
    }) => patchSalesOrderLine(order.id, lineId, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", order.id], next);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", order.id] });
    },
  });

  const applyPatch = (lineId: string, patch: { quantity?: string; unitPrice?: string }) => {
    if (draft) {
      onPatchLine?.(lineId, patch);
      return;
    }
    patchMutation.mutate({ lineId, patch });
  };

  const columns = useMemo<ColDef<SalesOrderDetailLine>[]>(
    () => [
      {
        field: "itemName",
        headerName: "Item",
        flex: 1,
        minWidth: 240,
        editable: false,
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) =>
          data ? (
            <div className="flex flex-col justify-center leading-tight py-(--space-1)">
              <span className="font-medium">{data.itemName}</span>
              <span className="text-[length:var(--text-xs)] text-muted-foreground">
                {data.unitName}
              </span>
            </div>
          ) : null,
      },
      {
        field: "itemSku",
        headerName: "SKU",
        width: 120,
        editable: false,
        cellClass: "font-mono text-[length:var(--text-xs)] text-muted-foreground",
        valueFormatter: ({ value }) => (value ? String(value) : "—"),
      },
      {
        field: "quantity",
        headerName: "Qty",
        type: "rightAligned",
        width: 90,
        editable,
        cellEditor: "agTextCellEditor",
        cellClass: "font-mono tabular-nums",
        valueFormatter: ({ value }) => formatQuantity(String(value ?? "0")) ?? "0",
        valueSetter: numericSetter("quantity", (value) => value > 0),
      },
      {
        field: "estimatedUnitCost",
        headerName: "Unit cost",
        type: "rightAligned",
        width: 110,
        editable: false,
        cellClass: "font-mono tabular-nums text-muted-foreground",
        valueGetter: ({ data }) =>
          data ? (data.actualUnitCost ?? data.estimatedUnitCost) : null,
        valueFormatter: ({ value }) =>
          value == null ? "—" : (formatPrice(String(value)) ?? "—"),
      },
      {
        field: "unitPrice",
        headerName: "Unit price",
        type: "rightAligned",
        width: 110,
        editable,
        cellEditor: "agTextCellEditor",
        cellClass: "font-mono tabular-nums",
        valueFormatter: ({ value }) => formatPrice(String(value ?? "0")) ?? "—",
        valueSetter: numericSetter("unitPrice", (value) => value >= 0),
      },
      {
        colId: "unitMargin",
        headerName: "Unit margin",
        type: "rightAligned",
        width: 130,
        editable: false,
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) => {
          if (!data) return null;
          const margin = lineMarginParts(data, order.status);
          return (
            <div className="flex flex-col items-end leading-tight py-(--space-1) font-mono tabular-nums">
              <span className={cn("font-semibold", marginToneClass(margin.marginPercent))}>
                {formatMarginPercent(margin.marginPercent)}
              </span>
              <span className="text-[length:var(--text-xs)] text-muted-foreground">
                {money(margin.unitMargin)} · {margin.statusLabel}
              </span>
            </div>
          );
        },
      },
      {
        field: "lineTotal",
        headerName: "Line total",
        type: "rightAligned",
        width: 120,
        editable: false,
        cellClass: "font-mono tabular-nums font-semibold",
        valueFormatter: ({ value }) => formatPrice(String(value ?? "0")) ?? "—",
      },
    ],
    [editable, order.status],
  );

  const handleRowsChange = (
    _rows: SalesOrderDetailLine[],
    change: EditableLineDataGridChange<SalesOrderDetailLine>,
  ) => {
    if (change.type === "row_reordered") {
      onReorderLines?.(_rows.map((row) => row.id));
      return;
    }
    if (change.type === "cell_edit_committed" && change.row && change.field) {
      if (change.field === "quantity") {
        applyPatch(change.row.id, { quantity: change.row.quantity });
      } else if (change.field === "unitPrice") {
        applyPatch(change.row.id, { unitPrice: change.row.unitPrice });
      }
    }
  };

  const requestDelete = (line: SalesOrderDetailLine) => {
    if (Number(line.allocatedQty) > 0 || Number(line.shippedQuantity) > 0) {
      setConfirmDelete(line);
      return;
    }
    void onDeleteLine?.(line);
  };

  return (
    <section className={cardStyles.section}>
      <div className="flex items-center gap-3 mb-3">
        <h2 className={cardStyles.sectionHeading} style={{ margin: 0 }}>
          Line items
          <span className={cardStyles.count}>
            {order.lines.length} {order.lines.length === 1 ? "line" : "lines"} ·{" "}
            {formatQuantity(String(totalQuantity))} units
          </span>
        </h2>
        {canAddLine ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAddingItem((prev) => !prev)}
            disabled={addingLine}
            className="ml-auto"
          >
            <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
            Add line
          </Button>
        ) : null}
      </div>

      {canAddLine && addingItem && itemOptions ? (
        <div className="mb-2 max-w-md">
          <InventoryItemCombobox
            options={itemOptions.filter((option) => !existingItemIds.has(option.id))}
            value=""
            onValueChange={(itemId) => {
              if (!itemId) return;
              const picked = itemOptions.find((o) => o.id === itemId);
              if (!picked) return;
              if (draft) {
                draft.addLine(
                  makeDraftLine({
                    itemId: picked.id,
                    itemName: picked.displayName || picked.name,
                    itemSku: picked.sku,
                    unitName: picked.unitName,
                    quantity: "1",
                    unitPrice: picked.defaultSellingPrice ?? "0",
                    estimatedUnitCost: picked.estimatedUnitCost,
                  }),
                );
              } else {
                onAddLineItem?.(picked);
              }
              setAddingItem(false);
            }}
            placeholder="Search items…"
            emptyMessage="No items found"
          />
        </div>
      ) : null}

      <EditableLineDataGrid<SalesOrderDetailLine>
        rows={order.lines}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={() => makeDraftLine({
          itemId: "",
          itemName: "",
          itemSku: null,
          unitName: "",
          quantity: "1",
          unitPrice: "0",
          estimatedUnitCost: null,
        })}
        onRowsChange={handleRowsChange}
        addLabel="Add line"
        emptyMessage="No line items yet. Use Add line to start."
        enableAddRow={false}
        enableReorder={editable}
        enableDelete={editable}
        canDeleteRow={(_row, rows) => draft != null || rows.length > 1}
        getDeleteDisabledReason={(_row, rows) =>
          draft == null && rows.length <= 1 ? "Order needs at least one line" : null
        }
        onDeleteRow={(row) => requestDelete(row)}
        minHeight={120}
      />

      {order.lines.length > 0 ? (
        <div className="flex justify-end gap-(--space-8) px-(--space-3) pt-(--space-2) text-[length:var(--text-sm)]">
          <span className="text-muted-foreground uppercase tracking-wide text-[length:var(--text-xs)] font-medium">
            Total
          </span>
          <span className="font-mono tabular-nums">
            {formatQuantity(String(totalQuantity))} units
          </span>
          <span className="font-mono tabular-nums font-semibold">
            {money(String(totalLineAmount))}
          </span>
        </div>
      ) : null}

      <AlertDialog
        open={confirmDelete != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete line?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete
                ? `${confirmDelete.itemName} has allocated or shipped quantity. Removing it will release those allocations. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (confirmDelete) void onDeleteLine?.(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );

  function numericSetter(
    field: "quantity" | "unitPrice",
    valid: (value: number) => boolean,
  ) {
    return (params: ValueSetterParams<SalesOrderDetailLine>) => {
      const parsed = Number.parseFloat(String(params.newValue).trim());
      if (!Number.isFinite(parsed) || !valid(parsed)) return false;
      const normalized = parsed.toString();
      if (normalized === Number.parseFloat(params.data[field]).toString()) return false;
      params.data[field] = normalized;
      return true;
    };
  }
}

function money(value: string | null | undefined): string {
  return formatPrice(String(value ?? "")) ?? "—";
}

function marginToneClass(value: string | null | undefined): string {
  const parsed = value == null ? NaN : Number(value);
  if (!Number.isFinite(parsed)) return "text-muted-foreground";
  if (parsed < 10) return "text-destructive";
  if (parsed < 30) return "text-[color:var(--color-warning)]";
  return "text-success";
}

function formatMarginPercent(value: string | null | undefined): string {
  const parsed = value == null ? NaN : Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${parsed.toFixed(1)}%`;
}

function sumNumeric(values: Array<string | null | undefined>): number {
  return values.reduce((total, value) => {
    const parsed = value == null ? NaN : Number(value);
    return Number.isFinite(parsed) ? total + parsed : total;
  }, 0);
}

function lineMarginParts(
  line: SalesOrderDetailLine,
  orderStatus: SalesOrderDetail["status"],
) {
  const hasActualMargin = line.actualCogs != null;
  const unitCost = hasActualMargin ? line.actualUnitCost : line.estimatedUnitCost;
  const unitPrice = Number(line.unitPrice);
  const parsedUnitCost = unitCost == null ? NaN : Number(unitCost);
  const unitMargin =
    Number.isFinite(unitPrice) && Number.isFinite(parsedUnitCost)
      ? normalizeMoney(unitPrice - parsedUnitCost)
      : null;
  return {
    unitCost,
    unitMargin,
    marginPercent: hasActualMargin ? line.actualMarginPercent : line.estimatedMarginPercent,
    statusLabel: hasActualMargin || orderStatus === "done" ? "Actual" : "Estimated",
  };
}
