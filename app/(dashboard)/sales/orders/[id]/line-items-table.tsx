"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ICellRendererParams,
  ValueSetterParams,
} from "ag-grid-community";
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
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
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
  const [rows, setRows] = useState(order.lines);

  useEffect(() => {
    setRows(order.lines);
  }, [order.lines]);

  const totalQuantity = sumNumeric(rows.map((line) => line.quantity));
  const totalLineAmount = sumNumeric(rows.map((line) => line.lineTotal));
  const canAddLine = editable && (draft != null || onAddLineItem != null) && itemOptions != null;
  const existingItemIds = useMemo(
    () => new Set(rows.filter((line) => !isBlankSalesOrderLine(line)).map((line) => line.itemId)),
    [rows],
  );
  const itemMap = useMemo(
    () => new Map((itemOptions ?? []).map((option) => [option.id, option])),
    [itemOptions],
  );

  // Live per-cell PATCH (draft mode short-circuits to onPatchLine).
  const patchMutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", order.id, "line-cell"),
    mutationFn: ({
      lineId,
      patch,
    }: {
      lineId: string;
      patch: { quantity?: string; unitPrice?: string };
    }) => patchSalesOrderLine(order.id, lineId, patch),
    onMutate: async ({ lineId, patch }) => {
      const queryKey = ["sales-order", order.id] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SalesOrderDetail>(queryKey);
      if (previous) {
        queryClient.setQueryData(queryKey, optimisticLinePatch(previous, lineId, patch));
      }
      return { previous, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData(context.queryKey, context.previous);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", order.id], next);
    },
  });

  const applyPatch = (lineId: string, patch: { quantity?: string; unitPrice?: string }) => {
    if (draft) {
      onPatchLine?.(lineId, patch);
      return;
    }
    patchMutation.mutate({ lineId, patch });
  };

  const fields = useMemo<LineField<SalesOrderDetailLine>[]>(
    () => [
      {
        field: "itemId",
        headerName: "Item",
        flex: 1,
        minWidth: 240,
        editable: (data) => editable && !isPersistedLine(data),
        kind: "inventory-item",
        options: (itemOptions ?? []).filter((option) => !existingItemIds.has(option.id)),
        placeholder: "Search items...",
        emptyMessage: "No items found",
        requiredMessage: "Item is required",
        createLinks: [
          { href: "/inventory/product", label: "Create product" },
          { href: "/inventory/material", label: "Create material" },
        ],
        getSecondaryText: (current) =>
          [current.sku, current.unitName]
            .filter((part): part is string => part != null && part !== "")
            .join(" · "),
        valueSetter: (params: ValueSetterParams<SalesOrderDetailLine, string | null>) => {
          const itemId = String(params.newValue ?? "");
          const item = itemMap.get(itemId);
          if (!item) return false;
          Object.assign(params.data, lineFromItem(item, params.data.id));
          return true;
        },
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) =>
          data ? (
            <div className="flex flex-col justify-center leading-tight py-(--space-1)">
              <span className="font-medium">
                {data.itemName || <span className="text-muted-foreground">Search items...</span>}
              </span>
              <span className="text-[length:var(--text-xs)] text-muted-foreground">
                {data.unitName}
              </span>
            </div>
          ) : null,
      },
      {
        field: "itemSku",
        kind: "display",
        headerName: "SKU",
        width: 120,
        cellClass: "text-[length:var(--text-xs)]",
        mono: true,
        muted: true,
        valueFormatter: ({ value }) => (value ? String(value) : "—"),
      },
      {
        field: "quantity",
        kind: "number",
        headerName: "Qty",
        rightAligned: true,
        width: 90,
        editable,
        mono: true,
        tooltipValueGetter: ({ data }) => data ? quantityLockReason(data) : null,
        valueFormatter: ({ value }) => formatQuantity(String(value ?? "0")) ?? "0",
        valueSetter: numericSetter("quantity", (value, line) => value >= minimumLineQuantity(line)),
      },
      {
        field: "estimatedUnitCost",
        kind: "display",
        headerName: "Unit cost",
        rightAligned: true,
        width: 110,
        mono: true,
        muted: true,
        valueGetter: ({ data }) =>
          data ? (data.actualUnitCost ?? data.estimatedUnitCost) : null,
        valueFormatter: ({ value }) =>
          value == null ? "—" : (formatPrice(String(value)) ?? "—"),
      },
      {
        field: "unitPrice",
        kind: "number",
        headerName: "Unit price",
        rightAligned: true,
        width: 110,
        editable,
        mono: true,
        valueFormatter: ({ value }) => formatPrice(String(value ?? "0")) ?? "—",
        valueSetter: numericSetter("unitPrice", (value) => value >= 0),
      },
      {
        colId: "unitMargin",
        kind: "display",
        headerName: "Unit margin",
        rightAligned: true,
        width: 130,
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
        kind: "display",
        headerName: "Line total",
        rightAligned: true,
        width: 120,
        mono: true,
        strong: true,
        valueFormatter: ({ value }) => formatPrice(String(value ?? "0")) ?? "—",
      },
    ],
    [editable, existingItemIds, itemMap, itemOptions, order.status],
  );

  const handleRowsChange = (
    nextRows: SalesOrderDetailLine[],
    change: EditableLineDataGridChange<SalesOrderDetailLine>,
  ) => {
    setRows(nextRows);
    if (change.type === "row_reordered") {
      onReorderLines?.(nextRows.filter((row) => !isBlankSalesOrderLine(row)).map((row) => row.id));
      return;
    }
    if (
      (change.type === "cell_edit_committed" || change.type === "blank_row_committed") &&
      change.row &&
      change.field === "itemId" &&
      !isPersistedLine(change.row)
    ) {
      const picked = itemMap.get(change.row.itemId);
      if (!picked) return;
      if (draft) {
        draft.addLine(lineFromItem(picked));
      } else {
        onAddLineItem?.(picked);
      }
      return;
    }
    if (change.type === "cell_edit_committed" && change.row && change.field && isPersistedLine(change.row)) {
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
            {rows.filter((line) => !isBlankSalesOrderLine(line)).length}{" "}
            {rows.filter((line) => !isBlankSalesOrderLine(line)).length === 1 ? "line" : "lines"} ·{" "}
            {formatQuantity(String(totalQuantity))} units
          </span>
        </h2>
      </div>

      <MutableLines<SalesOrderDetailLine>
        rows={rows}
        fields={fields}
        getRowId={(row) => row.id}
        createRow={() => makeBlankLine()}
        onRowsChange={handleRowsChange}
        addLabel="Add line"
        readOnly={!canAddLine}
        addDisabledReason={addingLine ? "Adding line..." : null}
        emptyMessage="No line items yet."
        canDeleteRow={(row, rows) =>
          isBlankSalesOrderLine(row) ||
          draft != null ||
          (rows.filter((line) => !isBlankSalesOrderLine(line)).length > 1 &&
            deleteLineLockedReason(row) == null)
        }
        getDeleteDisabledReason={(row, rows) =>
          isBlankSalesOrderLine(row)
            ? null
            : draft == null && rows.filter((line) => !isBlankSalesOrderLine(line)).length <= 1
            ? "Order needs at least one line"
            : deleteLineLockedReason(row)
        }
        onDeleteRow={(row) => {
          if (isBlankSalesOrderLine(row)) {
            setRows((current) => current.filter((line) => line.id !== row.id));
            return;
          }
          requestDelete(row);
        }}
        isBlankRow={isBlankSalesOrderLine}
      />

      {rows.some((line) => !isBlankSalesOrderLine(line)) ? (
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
    valid: (value: number, line: SalesOrderDetailLine) => boolean,
  ) {
    return (params: ValueSetterParams<SalesOrderDetailLine>) => {
      const parsed = Number.parseFloat(String(params.newValue).trim());
      if (!Number.isFinite(parsed) || !valid(parsed, params.data)) return false;
      const normalized = parsed.toString();
      if (normalized === Number.parseFloat(params.data[field]).toString()) return false;
      params.data[field] = normalized;
      return true;
    };
  }
}

function makeBlankLine() {
  return makeDraftLine({
    itemId: "",
    itemName: "",
    itemSku: null,
    unitName: "",
    quantity: "1",
    unitPrice: "0",
    estimatedUnitCost: null,
  });
}

function lineFromItem(item: SalesOrderItemOption, id?: string) {
  const line = makeDraftLine({
    itemId: item.id,
    itemName: item.displayName || item.name,
    itemSku: item.sku,
    unitName: item.unitName,
    quantity: "1",
    unitPrice: item.defaultSellingPrice ?? "0",
    estimatedUnitCost: item.estimatedUnitCost,
  });
  return id ? { ...line, id } : line;
}

function isBlankSalesOrderLine(line: SalesOrderDetailLine | undefined) {
  return !line?.itemId;
}

function isPersistedLine(line: SalesOrderDetailLine | undefined) {
  return Boolean(line?.id && !line.id.startsWith("draft-") && line.itemId);
}

function optimisticLinePatch(
  order: SalesOrderDetail,
  lineId: string,
  patch: { quantity?: string; unitPrice?: string },
): SalesOrderDetail {
  const lines = order.lines.map((line) => {
    if (line.id !== lineId) return line;
    const quantity = patch.quantity ?? line.quantity;
    const unitPrice = patch.unitPrice ?? line.unitPrice;
    return {
      ...line,
      quantity,
      unitPrice,
      lineTotal: (Number(quantity || 0) * Number(unitPrice || 0)).toFixed(2),
    };
  });
  const productRevenue = lines
    .reduce((sum, line) => sum + Number(line.lineTotal || 0), 0)
    .toFixed(2);

  return {
    ...order,
    lines,
    totalAmount: productRevenue,
    marginSummary: {
      ...order.marginSummary,
      productRevenue,
    },
  };
}

function minimumLineQuantity(line: SalesOrderDetailLine) {
  return (
    Number(line.plannedQuantity) +
    Number(line.shippedQuantity) +
    Number(line.cancelledQuantity)
  );
}

function quantityLockReason(line: SalesOrderDetailLine) {
  const minimum = minimumLineQuantity(line);
  if (minimum <= 0) return null;
  return `Quantity cannot be reduced below ${formatQuantity(String(minimum))} because fulfillment is already planned, shipped, or cancelled.`;
}

function deleteLineLockedReason(line: SalesOrderDetailLine) {
  if (Number(line.shippedQuantity) > 0) {
    return "This line has shipped quantity, so it cannot be removed.";
  }
  if (Number(line.cancelledQuantity) > 0) {
    return "This line has cancelled quantity, so it cannot be removed.";
  }
  if (Number(line.plannedQuantity) > 0) {
    return "This line is on a planned shipment. Edit or remove the shipment before removing the line.";
  }
  return null;
}

function money(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
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
