"use client";

import { useEffect, useMemo, useState } from "react";
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
import { CardSection } from "@/components/card-page/card-page";
import { cn } from "@/lib/utils";
import { formatPrice, formatQuantity, normalizeMoney } from "@/lib/format";
import type {
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderItemOption,
} from "@/app/(dashboard)/sales/types";
import { makeDraftLine } from "./order-draft";
import type { SalesOrderDraftController } from "./use-sales-order-draft-controller";

export type LineItemsTableProps = {
  order: SalesOrderDetail;
  editable: boolean;
  itemOptions?: SalesOrderItemOption[];
  controller: SalesOrderDraftController;
};

export function LineItemsTable({
  order,
  editable,
  itemOptions,
  controller,
}: LineItemsTableProps) {
  const [confirmDelete, setConfirmDelete] = useState<SalesOrderDetailLine | null>(null);
  const [rows, setRows] = useState(order.lines);

  useEffect(() => {
    setRows(order.lines);
  }, [order.lines]);

  const nonBlankRows = rows.filter((line) => !isBlankSalesOrderLine(line));
  const totalQuantity = sumNumeric(nonBlankRows.map((line) => line.quantity));
  const totalLineAmount = sumNumeric(nonBlankRows.map((line) => line.lineTotal));
  const canAddLine = editable && itemOptions != null;
  const existingItemIds = useMemo(
    () => new Set(rows.filter((line) => !isBlankSalesOrderLine(line)).map((line) => line.itemId)),
    [rows],
  );
  const itemMap = useMemo(
    () => new Map((itemOptions ?? []).map((option) => [option.id, option])),
    [itemOptions],
  );

  const applyPatch = (lineId: string, patch: { quantity?: string; unitPrice?: string }) => {
    controller.updateLine(lineId, patch);
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
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) => {
          if (!data) return null;
          const shipped = Number(data.shippedQuantity);
          return (
            <div className="flex flex-col items-end justify-center leading-tight py-(--space-1) font-mono tabular-nums">
              <span>{formatQuantity(data.quantity) ?? "0"}</span>
              {shipped > 0 ? (
                <span className="text-[length:var(--text-xs)] text-muted-foreground">
                  {formatQuantity(data.shippedQuantity)} shipped
                </span>
              ) : null}
            </div>
          );
        },
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
      controller.reorderLines(
        nextRows.filter((row) => !isBlankSalesOrderLine(row)).map((row) => row.id),
      );
      return;
    }
    if (isDraftLineSaveAttempt(change)) {
      const picked = itemMap.get(change.row.itemId);
      if (!picked || !isSavableDraftLine(change.row)) return;
      controller.addLine(
        lineFromItem(picked, change.row.id, {
          quantity: change.row.quantity,
          unitPrice: change.row.unitPrice,
        }),
      );
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
    if (deleteLineLockedReason(line)) return;
    if (Number(line.allocatedQty) > 0 || Number(line.shippedQuantity) > 0) {
      setConfirmDelete(line);
      return;
    }
    controller.removeLine(line.id);
  };

  const lineCount = nonBlankRows.length;

  return (
    <CardSection
      title="Line items"
      count={`· ${lineCount} ${lineCount === 1 ? "line" : "lines"} · ${
        formatQuantity(String(totalQuantity))
      } units`}
    >

      <MutableLines<SalesOrderDetailLine>
        rows={rows}
        fields={fields}
        getRowId={(row) => row.id}
        createRow={() => makeBlankLine()}
        onRowsChange={handleRowsChange}
        addLabel="Add line"
        readOnly={!canAddLine}
        addDisabledReason={null}
        emptyMessage="No line items yet."
        canDeleteRow={() => true}
        getDeleteDisabledReason={(row) =>
          isPersistedLine(row) ? deleteLineLockedReason(row) : null
        }
        onDeleteRow={(row) => {
          if (!isPersistedLine(row)) {
            setRows((current) => current.filter((line) => line.id !== row.id));
            return;
          }
          requestDelete(row);
        }}
      />

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
                if (confirmDelete) controller.removeLine(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardSection>
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

function lineFromItem(
  item: SalesOrderItemOption,
  id?: string,
  values?: { quantity?: string; unitPrice?: string },
) {
  const line = makeDraftLine({
    itemId: item.id,
    itemName: item.displayName || item.name,
    itemSku: item.sku,
    unitName: item.unitName,
    quantity: values?.quantity ?? "1",
    unitPrice: values?.unitPrice ?? item.defaultSellingPrice ?? "0",
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

function isDraftLineSaveAttempt(
  change: EditableLineDataGridChange<SalesOrderDetailLine>,
): change is EditableLineDataGridChange<SalesOrderDetailLine> & {
  row: SalesOrderDetailLine;
  field: "itemId" | "quantity" | "unitPrice";
} {
  return (
    change.type === "cell_edit_committed" &&
    change.row != null &&
    (change.field === "itemId" ||
      change.field === "quantity" ||
      change.field === "unitPrice") &&
    !isPersistedLine(change.row)
  );
}

function isSavableDraftLine(line: SalesOrderDetailLine) {
  return (
    Boolean(line.itemId) &&
    Number(line.quantity) > 0 &&
    Number(line.unitPrice) > 0
  );
}

function minimumLineQuantity(line: SalesOrderDetailLine) {
  return (
    Number(line.shippedQuantity) +
    Number(line.cancelledQuantity)
  );
}

function quantityLockReason(line: SalesOrderDetailLine) {
  const minimum = minimumLineQuantity(line);
  if (minimum <= 0) return null;
  return `Quantity cannot be reduced below ${formatQuantity(String(minimum))} because quantity has already shipped or been cancelled.`;
}

function deleteLineLockedReason(line: SalesOrderDetailLine) {
  if (Number(line.shippedQuantity) > 0) {
    return "This line has shipped quantity, so it cannot be removed.";
  }
  if (Number(line.cancelledQuantity) > 0) {
    return "This line has cancelled quantity, so it cannot be removed.";
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
