"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  type OrderStatusControlConfig,
  type OrderStatusOption,
} from "@/components/card-page/order-status-control";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableHeaderCell,
  FramedTableHead,
  FramedTableRow,
} from "@/components/table-frame";
import { ManufacturingCompletionDialog } from "@/components/manufacturing/manufacturing-completion-dialog";
import { NoticePanel } from "@/components/notice-panel";
import {
  shipSalesOrder,
  SalesOrderApiError,
} from "@/lib/api/clients/sales-orders";
import { updatePurchaseOrderStatus } from "@/lib/api/clients/purchase-orders";
import {
  patchManufacturingOrder,
  startManufacturingOrder,
} from "@/lib/api/clients/manufacturing-orders";
import { deriveProductionStatus } from "@/lib/manufacturing/derive-status";
import { deriveOrderDisplayStatus } from "@/lib/sales/order-display-status";
import { formatQuantity } from "@/lib/format";
import {
  stockWarningDescription,
  stockWarningTitle,
} from "@/lib/sales/stock-warning-copy";
import type {
  NegativeStockWarningPayload,
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderListLine,
  SalesOrderListRow,
} from "@/app/(dashboard)/sales/types";
import type { ManufacturingPickProgressStatus } from "@/app/(dashboard)/manufacturing/types";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

export type SalesOrderStatusFields = SalesOrderListRow | SalesOrderDetail;
export type SalesOrderStatusContext = { order: SalesOrderStatusFields };

const SALES_STATUS_OPTIONS: OrderStatusOption[] = [
  { value: "NOT SHIPPED", label: "Not shipped", tone: "neutral" },
  { value: "PARTIALLY SHIPPED", label: "Partially shipped", tone: "warning" },
  { value: "SHIPPED", label: "Shipped", tone: "success" },
];

export const salesOrderStatusConfig: OrderStatusControlConfig<SalesOrderStatusContext> = {
  type: "sales",
  options: () => SALES_STATUS_OPTIONS,
  current: ({ order }) => deriveOrderDisplayStatus(order).label,
  transitionKind: (from, to, { order }) => {
    if (from === "SHIPPED") return "disabled";
    if (to === from) return "noop";
    if (to === "SHIPPED") return "dialog";
    if (to === "PARTIALLY SHIPPED") {
      return getShippableRows(order).length > 0 ? "dialog" : "disabled";
    }
    return "disabled";
  },
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to !== "SHIPPED" && to !== "PARTIALLY SHIPPED") return null;
    return (
      <ShipOrderDialog
        order={ctx.order}
        mode={to === "PARTIALLY SHIPPED" ? "partial" : "all"}
        onClose={onClose}
        onDone={onDone}
      />
    );
  },
};

export function isSalesOrderStatusDisabled(order: SalesOrderStatusFields) {
  return deriveOrderDisplayStatus(order).label === "SHIPPED";
}

function NegativeStockNotice({ items }: { items: NegativeStockWarningPayload[] }) {
  return (
    <NoticePanel className="space-y-2">
      <p className="text-sm font-medium text-[var(--color-warning)]">
        {stockWarningTitle(items[0])}
      </p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {items.map((item) => (
          <li key={item.itemId}>
            {stockWarningDescription(item)}
            {item.commitments?.length ? (
              <ul className="mt-1 space-y-0.5">
                {item.commitments.map((commitment) => (
                  <li key={`${commitment.referenceType}:${commitment.referenceId}`}>
                    {commitment.label}: {formatQuantity(String(commitment.quantity))}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </NoticePanel>
  );
}

function useShipMutation(run: (confirmNegativeStock: boolean) => Promise<void>, onDone: () => void) {
  const [warning, setWarning] = useState<NegativeStockWarningPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (confirmNegativeStock: boolean) => {
      if (confirmNegativeStock) {
        setWarning(null);
      }
      return run(confirmNegativeStock);
    },
    onSuccess: () => onDone(),
    onError: (err) => {
      if (err instanceof SalesOrderApiError && err.status === 409 && err.negativeStock) {
        setWarning(err.negativeStock);
        setError(null);
        mutation.reset();
        return;
      }
      setWarning(null);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    },
  });
  return { mutation, warning, error };
}

function ShipOrderDialog({
  order,
  mode,
  onClose,
  onDone,
}: {
  order: SalesOrderStatusFields;
  mode: "partial" | "all";
  onClose: () => void;
  onDone: () => void;
}) {
  const autoSubmittedRef = useRef(false);
  const [rows, setRows] = useState<ShipDialogRow[]>(() =>
    getShippableRows(order).map((line) => ({
      ...line,
      selected: true,
      quantity: line.remainingQuantity,
    }))
  );
  const selectedLines = rows
    .filter((row) => row.selected)
    .map((row) => ({
      salesOrderLineId: row.salesOrderLineId,
      quantity: normalizeDialogQuantity(row.quantity),
    }))
    .filter((line) => {
      const quantity = Number(line.quantity);
      return Number.isFinite(quantity) && quantity > 0;
    });
  const invalidRows = rows.filter((row) => {
    if (!row.selected) return false;
    const quantity = Number(normalizeDialogQuantity(row.quantity));
    const remaining = Number(row.remainingQuantity);
    return !Number.isFinite(quantity) || quantity <= 0 || quantity > remaining;
  });

  const { mutation, warning, error } = useShipMutation(
    (confirm) =>
      shipSalesOrder(
        order.id,
        confirm,
        mode === "partial" ? selectedLines : undefined
      ),
    onDone,
  );
  const canSubmit =
    !mutation.isPending &&
    (mode === "all" || (selectedLines.length > 0 && invalidRows.length === 0));

  useEffect(() => {
    if (mode !== "all" || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    mutation.mutate(false);
  }, [mode, mutation]);

  if (mode === "all" && !warning && !error) {
    return null;
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size={mode === "partial" ? "3xl" : "default"}>
        <DialogHeader>
          <DialogTitle>
            {warning
              ? stockWarningTitle(warning)
              : mode === "partial"
                ? `Deliver items from ${order.orderNumber}`
                : "Could not ship order"}
          </DialogTitle>
          {mode === "partial" ? (
            <DialogDescription>
              Select which items to deliver.
            </DialogDescription>
          ) : warning ? (
            <DialogDescription>
              Review the shortage before shipping this order.
            </DialogDescription>
          ) : (
            <DialogDescription>
              Fix the issue below, then try again.
            </DialogDescription>
          )}
        </DialogHeader>
        {mode === "partial" ? (
          <div className="space-y-(--space-4)">
            <FramedTable containerClassName="border border-[var(--color-line)]">
              <FramedTableHead>
                <FramedTableRow>
                  <FramedTableHeaderCell className="w-10">
                    <Checkbox
                      checked={rows.length > 0 && rows.every((row) => row.selected)}
                      onCheckedChange={(checked) => {
                        setRows((current) =>
                          current.map((row) => ({
                            ...row,
                            selected: checked === true,
                          }))
                        );
                      }}
                      aria-label="Select all items"
                    />
                  </FramedTableHeaderCell>
                  <FramedTableHeaderCell>Item</FramedTableHeaderCell>
                  <FramedTableHeaderCell>Location</FramedTableHeaderCell>
                  <FramedTableHeaderCell className="w-44 text-right">Quantity to deliver</FramedTableHeaderCell>
                  <FramedTableHeaderCell className="w-44 text-right">Quantity left available</FramedTableHeaderCell>
                </FramedTableRow>
              </FramedTableHead>
              <FramedTableBody>
                {rows.map((row) => {
                  const quantity = Number(normalizeDialogQuantity(row.quantity));
                  const remaining = Number(row.remainingQuantity);
                  const left =
                    row.selected && Number.isFinite(quantity)
                      ? Math.max(0, remaining - quantity)
                      : remaining;
                  const invalid =
                    row.selected &&
                    (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining);
                  return (
                    <FramedTableRow key={row.salesOrderLineId}>
                      <FramedTableCell>
                        <Checkbox
                          checked={row.selected}
                          onCheckedChange={(checked) => {
                            setRows((current) =>
                              current.map((candidate) =>
                                candidate.salesOrderLineId === row.salesOrderLineId
                                  ? { ...candidate, selected: checked === true }
                                  : candidate
                              )
                            );
                          }}
                          aria-label={`Select ${row.itemName}`}
                        />
                      </FramedTableCell>
                      <FramedTableCell className={row.selected ? "" : "text-muted-foreground"}>
                        {row.itemName}
                      </FramedTableCell>
                      <FramedTableCell className="text-muted-foreground">Default</FramedTableCell>
                      <FramedTableCell className="text-right">
                        {row.selected ? (
                          <div className="flex items-center justify-end gap-(--space-2)">
                            <Input
                              className="h-(--height-input-sm) w-28 text-right font-mono tabular-nums"
                              inputMode="decimal"
                              value={row.quantity}
                              aria-invalid={invalid}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setRows((current) =>
                                  current.map((candidate) =>
                                    candidate.salesOrderLineId === row.salesOrderLineId
                                      ? { ...candidate, quantity: value }
                                      : candidate
                                  )
                                );
                              }}
                            />
                            <span className="text-muted-foreground">{row.unitName}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Qty to deliver</span>
                        )}
                      </FramedTableCell>
                      <FramedTableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(String(left))}{" "}
                        <span className="font-sans text-muted-foreground">{row.unitName}</span>
                      </FramedTableCell>
                    </FramedTableRow>
                  );
                })}
              </FramedTableBody>
            </FramedTable>
          </div>
        ) : null}
        {warning ? <NegativeStockNotice items={[warning]} /> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate(warning != null)} disabled={!canSubmit}>
            {mutation.isPending
              ? "Delivering..."
              : warning
                ? "Deliver anyway"
                : mode === "partial"
                  ? "Deliver selected"
                  : "Deliver all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ShipDialogRow = {
  salesOrderLineId: string;
  itemName: string;
  unitName: string;
  remainingQuantity: string;
  selected: boolean;
  quantity: string;
};

function getShippableRows(order: SalesOrderStatusFields): Omit<ShipDialogRow, "selected" | "quantity">[] {
  return order.lines.flatMap((line) => {
    const row = toShippableRow(line);
    if (!row || Number(row.remainingQuantity) <= 0) return [];
    return [row];
  });
}

function toShippableRow(
  line: SalesOrderDetailLine | SalesOrderListLine,
): Omit<ShipDialogRow, "selected" | "quantity"> | null {
  if (isSalesOrderDetailLine(line)) {
    return {
      salesOrderLineId: line.id,
      itemName: line.itemName,
      unitName: line.unitName,
      remainingQuantity: line.remainingQuantity,
    };
  }

  const salesOrderLineId = line.id ?? line.salesOrderLineId;
  if (!salesOrderLineId) return null;

  return {
    salesOrderLineId,
    itemName:
      line.attrs.length > 0
        ? `${line.attrs.join(" / ")} ${line.masterName}`
        : line.masterName,
    unitName: line.unitName,
    remainingQuantity:
      line.remainingQty ??
      String(Math.max(0, Number(line.quantity) - Number(line.shippedQuantity ?? "0"))),
  };
}

function isSalesOrderDetailLine(
  line: SalesOrderDetailLine | SalesOrderListLine,
): line is SalesOrderDetailLine {
  return "remainingQuantity" in line;
}

function normalizeDialogQuantity(value: string) {
  return value.trim();
}

export type ManufacturingStatusFields = {
  id: string;
  status: ManufacturingOrderStatus;
  isBlocked: boolean;
  manufacturingMode: string;
  pickProgressStatus: ManufacturingPickProgressStatus;
  completedBatchCount: number;
  startedAt?: Date | string | null;
  actualQuantity?: string | null;
};

export type ManufacturingStatusContext = { order: ManufacturingStatusFields };

const MANUFACTURING_STATUS_OPTIONS: OrderStatusOption[] = [
  { value: "not_started", label: "Not started", tone: "neutral" },
  { value: "blocked", label: "Blocked", tone: "danger" },
  { value: "in_progress", label: "Work in progress", tone: "warning" },
  { value: "partially_complete", label: "Partially complete", tone: "warning" },
  { value: "done", label: "Done", tone: "success" },
];

export const manufacturingOrderStatusConfig: OrderStatusControlConfig<ManufacturingStatusContext> = {
  type: "manufacturing",
  options: () => MANUFACTURING_STATUS_OPTIONS,
  current: ({ order }) =>
    deriveProductionStatus({
      status: order.status,
      isBlocked: order.isBlocked,
      pickProgressStatus: order.pickProgressStatus,
      completedBatchCount: order.completedBatchCount,
      startedAt: order.startedAt,
    }),
  transitionKind: (from, to, { order }) => {
    if (from === "done") return "disabled";
    if (to === from) return "noop";
    if (to === "not_started" && hasManufacturingWorkStarted(order)) return "disabled";
    if (to === "partially_complete" && order.manufacturingMode !== "batch") {
      return "disabled";
    }
    if (to === "partially_complete" || to === "done") return "dialog";
    return "instant";
  },
  runInstant: (to, { order }) => {
    if (to === "in_progress") {
      return startManufacturingOrder(order.id).then(() => undefined);
    }
    return patchManufacturingOrder(order.id, { isBlocked: to === "blocked" }).then(
      () => undefined
    );
  },
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to !== "done" && to !== "partially_complete") return null;
    return (
      <ManufacturingCompletionDialog
        orderId={ctx.order.id}
        mode={to === "done" ? "complete" : "output"}
        onClose={onClose}
        onDone={onDone}
      />
    );
  },
};

function hasManufacturingWorkStarted(order: ManufacturingStatusFields) {
  return (
    order.startedAt != null ||
    order.pickProgressStatus !== "not_started" ||
    order.completedBatchCount > 0
  );
}

export function isManufacturingStatusDisabled(
  order: Pick<ManufacturingStatusFields, "status">
) {
  return order.status === "done";
}

export type PurchaseStatusContext = {
  orderId: string;
  status: PurchaseOrderStatus;
};

const PURCHASE_STATUS_OPTIONS: OrderStatusOption[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "ordered", label: "Ordered", tone: "info" },
  { value: "partial", label: "Partially received", tone: "warning" },
  { value: "received", label: "Received", tone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "danger" },
];

function purchaseStatusOptions(status: PurchaseOrderStatus) {
  const current = PURCHASE_STATUS_OPTIONS.find((option) => option.value === status);
  const next =
    status === "draft"
      ? PURCHASE_STATUS_OPTIONS.find((option) => option.value === "ordered")
      : status === "ordered" || status === "partial"
        ? PURCHASE_STATUS_OPTIONS.find((option) => option.value === "received")
        : null;

  return [current, next].filter(
    (option): option is OrderStatusOption => Boolean(option),
  );
}

function canPurchaseOrderTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus) {
  if (from === "draft") return to === "ordered";
  if (from === "ordered") return to === "received";
  if (from === "partial") return to === "received";
  return false;
}

export const purchaseOrderStatusConfig: OrderStatusControlConfig<PurchaseStatusContext> = {
  type: "purchase",
  options: ({ status }) => purchaseStatusOptions(status),
  current: ({ status }) => status,
  transitionKind: (from, to) => {
    if (to === from) return "noop";
    if (!canPurchaseOrderTransition(from as PurchaseOrderStatus, to as PurchaseOrderStatus)) {
      return "disabled";
    }
    return to === "received" ? "dialog" : "instant";
  },
  runInstant: (to, { orderId }) =>
    updatePurchaseOrderStatus(orderId, to as PurchaseOrderStatus).then(() => undefined),
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to !== "received") return null;
    return <ReceiveConfirmDialog orderId={ctx.orderId} onClose={onClose} onDone={onDone} />;
  },
};

function ReceiveConfirmDialog({
  orderId,
  onClose,
  onDone,
}: {
  orderId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () => updatePurchaseOrderStatus(orderId, "received"),
    onSuccess: () => onDone(),
  });

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as received?</DialogTitle>
          <DialogDescription>
            All remaining lines will be committed to inventory at their listed receiving
            locations.
          </DialogDescription>
        </DialogHeader>
        {mutation.isError ? (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Failed to receive."}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Receiving..." : "Mark received"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
