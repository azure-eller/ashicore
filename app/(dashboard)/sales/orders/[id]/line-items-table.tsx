"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
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
import { Input } from "@/components/ui/input";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipHeader } from "@/components/tooltip-header";
import { patchSalesOrderLine } from "@/lib/api/clients/sales-orders";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { cn } from "@/lib/utils";
import { formatPrice, formatQuantity, normalizeMoney } from "@/lib/format";
import {
  ITEM_SKU_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  SALES_LINE_QTY_TOOLTIP,
  SALES_UNIT_PRICE_TOOLTIP,
  UNIT_COST_TOOLTIP,
  UNIT_MARGIN_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderItemOption,
} from "@/app/(dashboard)/sales/types";
import { makeDraftLine, type OrderDraftController } from "./order-draft";
import cardStyles from "@/components/card-page/card-page.module.css";
import styles from "./order-card.module.css";

export type LineItemsTableProps = {
  order: SalesOrderDetail;
  editable: boolean;
  itemOptions?: SalesOrderItemOption[];
  draft?: OrderDraftController;
  onAddLine?: () => void;
  onDeleteLine?: (line: SalesOrderDetailLine) => Promise<void> | void;
  deletingLineId?: string | null;
};

export function LineItemsTable({
  order,
  editable,
  itemOptions,
  draft,
  onAddLine,
  onDeleteLine,
  deletingLineId,
}: LineItemsTableProps) {
  const [confirmDelete, setConfirmDelete] = useState<SalesOrderDetailLine | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const totalQuantity = sumNumeric(order.lines.map((line) => line.quantity));
  const totalLineAmount = sumNumeric(order.lines.map((line) => line.lineTotal));
  // Draft lines can be removed freely; a saved order keeps at least one line.
  const canRemove = editable && (draft != null || order.lines.length > 1);
  const existingItemIds = new Set(order.lines.map((line) => line.itemId));

  const handleDeleteRequest = (line: SalesOrderDetailLine) => {
    if (!canRemove) return;
    setConfirmDelete(line);
  };

  const handleDeleteConfirm = async () => {
    const target = confirmDelete;
    if (!target || !onDeleteLine) return;
    await onDeleteLine(target);
    setConfirmDelete(null);
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
        {editable && (draft || onAddLine) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (draft ? setAddingItem(true) : onAddLine?.())}
            className="ml-auto"
          >
            <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
            Add line
          </Button>
        ) : null}
      </div>

      <div className="rounded-none border border-[var(--color-line)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>
                <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Qty" tooltip={SALES_LINE_QTY_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Unit cost" tooltip={UNIT_COST_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Unit price" tooltip={SALES_UNIT_PRICE_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Unit margin" tooltip={UNIT_MARGIN_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Line total" tooltip={LINE_TOTAL_TOOLTIP} />
              </TableHead>
              {editable ? <TableHead className="w-20" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={editable ? 8 : 7}
                  className="text-center text-muted-foreground"
                >
                  No line items yet. Click <span className="font-semibold">Add line</span> to start.
                </TableCell>
              </TableRow>
            ) : (
              order.lines.map((line) => {
                const margin = lineMarginParts(line, order.status);
                return (
                  <TableRow key={line.id} className="group/line">
                    <TableCell>
                      <Link
                        href={itemDetailHref("product", line.itemId)}
                        className="font-medium hover:underline"
                      >
                        {line.itemName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{line.unitName}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {line.itemSku ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {editable ? (
                        <LineNumericCell
                          orderId={order.id}
                          lineId={line.id}
                          field="quantity"
                          initial={line.quantity}
                          draft={draft}
                          format={(value) => formatQuantity(value) ?? ""}
                        />
                      ) : (
                        formatQuantity(line.quantity)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money(margin.unitCost)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {editable ? (
                        <LineNumericCell
                          orderId={order.id}
                          lineId={line.id}
                          field="unitPrice"
                          initial={line.unitPrice}
                          draft={draft}
                          format={(value) => formatPrice(value) ?? ""}
                        />
                      ) : (
                        money(line.unitPrice)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      <div className={cn("font-semibold", marginToneClass(margin.marginPercent))}>
                        {formatMarginPercent(margin.marginPercent)}
                      </div>
                      <div className="font-sans text-xs text-muted-foreground">
                        {money(margin.unitMargin)} · {margin.statusLabel}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {money(line.lineTotal)}
                    </TableCell>
                    {editable ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/line:opacity-100 focus-within:opacity-100">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:text-destructive"
                                disabled={!canRemove || deletingLineId === line.id}
                                onClick={() => handleDeleteRequest(line)}
                                aria-label={`Delete ${line.itemName}`}
                              >
                                <HugeiconsIcon icon={Delete02Icon} size={14} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {canRemove ? "Delete line" : "Order needs at least one line"}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
            {draft && addingItem && itemOptions ? (
              <TableRow>
                <TableCell colSpan={editable ? 8 : 7}>
                  <InventoryItemCombobox
                    options={itemOptions.filter(
                      (option) => !existingItemIds.has(option.id),
                    )}
                    value=""
                    onValueChange={(itemId) => {
                      if (!itemId) return;
                      const picked = itemOptions.find((o) => o.id === itemId);
                      if (!picked) return;
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
                      setAddingItem(false);
                    }}
                    placeholder="Search items…"
                    emptyMessage="No items found"
                  />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          {order.lines.length > 0 ? (
            <TableFooter>
              <TableRow>
                <TableCell
                  colSpan={2}
                  className="text-xs font-medium uppercase text-muted-foreground"
                >
                  Total
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatQuantity(String(totalQuantity))}
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-mono tabular-nums font-semibold">
                  {money(String(totalLineAmount))}
                </TableCell>
                {editable ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
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
                ? `${confirmDelete.itemName} will be removed from this order. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
              disabled={confirmDelete != null && deletingLineId === confirmDelete.id}
            >
              {confirmDelete != null && deletingLineId === confirmDelete.id
                ? "Deleting…"
                : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {styles ? null : null}
    </section>
  );
}

function LineNumericCell({
  orderId,
  lineId,
  field,
  initial,
  draft,
  format,
}: {
  orderId: string;
  lineId: string;
  field: "quantity" | "unitPrice";
  initial: string;
  draft?: OrderDraftController;
  format: (value: string) => string;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial);
  const mutation = useMutation({
    mutationKey: ["sales-order", orderId, "patch", "line", lineId, field],
    mutationFn: (next: string) =>
      patchSalesOrderLine(orderId, lineId, { [field]: next }),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", orderId], next);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", orderId] });
    },
  });

  const commit = () => {
    const trimmed = value.trim();
    const parsed = Number.parseFloat(trimmed);
    const minValid = field === "quantity" ? parsed > 0 : parsed >= 0;
    if (!Number.isFinite(parsed) || !minValid) {
      setValue(initial);
      return;
    }
    const normalized = parsed.toString();
    if (normalized === Number.parseFloat(initial).toString()) return;
    if (draft) {
      draft.updateLine(lineId, { [field]: normalized });
      return;
    }
    mutation.mutate(normalized);
  };

  return (
    <Input
      type="number"
      inputMode="decimal"
      step="0.0001"
      min="0"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setValue(initial);
          event.currentTarget.blur();
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
      className="h-(--height-input-sm) text-right text-[length:var(--text-sm)] font-mono tabular-nums"
      aria-invalid={mutation.isError || undefined}
      title={mutation.isError ? "Save failed" : format(initial)}
    />
  );
}

function money(value: string | null | undefined): string {
  return formatPrice(value) ?? "—";
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
