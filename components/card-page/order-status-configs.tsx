"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import {
  getPurchaseOrderDetail,
  receivePurchaseOrder,
  updatePurchaseOrderStatus,
} from "@/lib/api/clients/purchase-orders";
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
import type { PurchaseOrderDetailLine } from "@/app/(dashboard)/purchasing/types";
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
    <NoticePanel className="space-y-(--space-3)">
      <p className="text-[length:var(--text-sm)] font-medium text-[var(--status-warning-ink)]">
        {stockWarningTitle(items[0])}
      </p>
      <ul className="space-y-(--space-1) text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
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
                      <FramedTableCell className={row.selected ? "" : "text-[var(--color-ink-faint)]"}>
                        {row.itemName}
                      </FramedTableCell>
                      <FramedTableCell className="text-[var(--color-ink-faint)]">Default</FramedTableCell>
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
                            <span className="text-[var(--color-ink-faint)]">{row.unitName}</span>
                          </div>
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">Qty to deliver</span>
                        )}
                      </FramedTableCell>
                      <FramedTableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(String(left))}{" "}
                        <span className="font-[var(--font-body)] text-[var(--color-ink-faint)]">{row.unitName}</span>
                      </FramedTableCell>
                    </FramedTableRow>
                  );
                })}
              </FramedTableBody>
            </FramedTable>
          </div>
        ) : null}
        {warning ? <NegativeStockNotice items={[warning]} /> : null}
        {error ? <p className="text-sm text-[var(--status-danger-ink)]">{error}</p> : null}
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
        ? `${line.masterName} / ${line.attrs.join(" / ")}`
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
  return PURCHASE_STATUS_OPTIONS.filter(
    (option) =>
      option.value === status ||
      canPurchaseOrderTransition(status, option.value as PurchaseOrderStatus),
  );
}

function canPurchaseOrderTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus) {
  if (from === "draft") return to === "ordered";
  if (from === "ordered") return to === "partial" || to === "received";
  if (from === "partial") return to === "partial" || to === "received";
  return false;
}

export const purchaseOrderStatusConfig: OrderStatusControlConfig<PurchaseStatusContext> = {
  type: "purchase",
  options: ({ status }) => purchaseStatusOptions(status),
  current: ({ status }) => status,
  transitionKind: (from, to) => {
    if (!canPurchaseOrderTransition(from as PurchaseOrderStatus, to as PurchaseOrderStatus)) {
      return "disabled";
    }
    return to === "partial" || to === "received" ? "dialog" : "instant";
  },
  runInstant: (to, { orderId }) =>
    updatePurchaseOrderStatus(orderId, to as PurchaseOrderStatus).then(() => undefined),
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to !== "partial" && to !== "received") return null;
    return (
      <ReceiveConfirmDialog
        mode={to}
        orderId={ctx.orderId}
        onClose={onClose}
        onDone={onDone}
      />
    );
  },
};

function ReceiveConfirmDialog({
  mode,
  orderId,
  onClose,
  onDone,
}: {
  mode: "partial" | "received";
  orderId: string;
  onClose: () => void;
  onDone: (status?: PurchaseOrderStatus) => void;
}) {
  const orderQuery = useQuery({
    queryKey: ["purchase-order-receive", orderId],
    queryFn: () => getPurchaseOrderDetail(orderId),
  });
  const order = orderQuery.data;
  const initialRows =
    order?.lines.flatMap((line) => {
      const row = toReceivableRow(line);
      if (!row || Number(row.remainingQuantity) <= 0) return [];
      return [
        {
          ...row,
          quantity: mode === "received" ? row.remainingQuantity : "",
        },
      ];
    }) ?? [];

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>Receive purchase order</DialogTitle>
          <DialogDescription>
            Enter the quantities received for each material.
          </DialogDescription>
        </DialogHeader>
        {orderQuery.isLoading ? (
          <p className="text-sm text-[var(--color-ink-faint)]">Loading purchase order...</p>
        ) : orderQuery.isError ? (
          <p className="text-sm text-[var(--status-danger-ink)]">
            {orderQuery.error instanceof Error
              ? orderQuery.error.message
              : "Failed to load purchase order."}
          </p>
        ) : (
          <ReceiveForm
            key={orderQuery.dataUpdatedAt}
            mode={mode}
            orderId={orderId}
            initialRows={initialRows}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceiveForm({
  mode,
  orderId,
  initialRows,
  onClose,
  onDone,
}: {
  mode: "partial" | "received";
  orderId: string;
  initialRows: ReceiveDialogRow[];
  onClose: () => void;
  onDone: (status?: PurchaseOrderStatus) => void;
}) {
  const [rows, setRows] = useState<ReceiveDialogRow[]>(initialRows);
  const mutation = useMutation({
    mutationFn: () =>
      receivePurchaseOrder(orderId, {
        lines: rows
          .map((row) => ({
            lineId: row.lineId,
            quantityReceived: normalizeDialogQuantity(row.quantity),
            disposition: "available" as const,
          }))
          .filter((line) => Number(line.quantityReceived) > 0),
      }),
    onSuccess: (result) => onDone(result.status),
  });
  const invalidRows = rows.filter((row) => {
    const quantity = Number(normalizeDialogQuantity(row.quantity));
    const remaining = Number(row.remainingQuantity);
    return (
      row.quantity.trim() !== "" &&
      (!Number.isFinite(quantity) || quantity < 0 || quantity > remaining)
    );
  });
  const selectedRows = rows.filter((row) => Number(normalizeDialogQuantity(row.quantity)) > 0);
  const canSubmit =
    !mutation.isPending && selectedRows.length > 0 && invalidRows.length === 0;

  if (rows.length === 0) {
    return (
      <>
        <p className="text-sm text-[var(--color-ink-faint)]">
          There are no remaining quantities to receive.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <FramedTable containerClassName="border border-[var(--color-line)]">
        <FramedTableHead>
          <FramedTableRow>
            <FramedTableHeaderCell>Item</FramedTableHeaderCell>
            <FramedTableHeaderCell className="w-36 text-right">Ordered</FramedTableHeaderCell>
            <FramedTableHeaderCell className="w-36 text-right">Received</FramedTableHeaderCell>
            <FramedTableHeaderCell className="w-36 text-right">Remaining</FramedTableHeaderCell>
            <FramedTableHeaderCell className="w-44 text-right">Receive now</FramedTableHeaderCell>
          </FramedTableRow>
        </FramedTableHead>
        <FramedTableBody>
          {rows.map((row) => {
            const quantity = Number(normalizeDialogQuantity(row.quantity));
            const remaining = Number(row.remainingQuantity);
            const invalid =
              row.quantity.trim() !== "" &&
              (!Number.isFinite(quantity) || quantity < 0 || quantity > remaining);

            return (
              <FramedTableRow key={row.lineId}>
                <FramedTableCell>{row.itemName}</FramedTableCell>
                <FramedTableCell className="text-right font-mono tabular-nums">
                  {formatQuantity(row.quantityOrdered)}{" "}
                  <span className="font-[var(--font-body)] text-[var(--color-ink-faint)]">{row.unitName}</span>
                </FramedTableCell>
                <FramedTableCell className="text-right font-mono tabular-nums">
                  {formatQuantity(row.quantityReceived)}{" "}
                  <span className="font-[var(--font-body)] text-[var(--color-ink-faint)]">{row.unitName}</span>
                </FramedTableCell>
                <FramedTableCell className="text-right font-mono tabular-nums">
                  {formatQuantity(row.remainingQuantity)}{" "}
                  <span className="font-[var(--font-body)] text-[var(--color-ink-faint)]">{row.unitName}</span>
                </FramedTableCell>
                <FramedTableCell className="text-right">
                  <div className="flex items-center justify-end gap-(--space-2)">
                    <Input
                      aria-label={`Quantity received for ${row.itemName}`}
                      className="h-(--height-input-sm) w-28 text-right font-mono tabular-nums"
                      inputMode="decimal"
                      value={row.quantity}
                      aria-invalid={invalid}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRows((current) =>
                          current.map((candidate) =>
                            candidate.lineId === row.lineId
                              ? { ...candidate, quantity: value }
                              : candidate
                          )
                        );
                      }}
                    />
                    <span className="text-[var(--color-ink-faint)]">{row.unitName}</span>
                  </div>
                </FramedTableCell>
              </FramedTableRow>
            );
          })}
        </FramedTableBody>
      </FramedTable>
        {mutation.isError ? (
          <p className="text-sm text-[var(--status-danger-ink)]">
            {mutation.error instanceof Error ? mutation.error.message : "Failed to receive."}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending
              ? "Receiving..."
              : mode === "partial"
                ? "Receive selected"
                : "Mark received"}
          </Button>
        </DialogFooter>
    </>
  );
}

type ReceiveDialogRow = {
  lineId: string;
  itemName: string;
  unitName: string;
  quantityOrdered: string;
  quantityReceived: string;
  remainingQuantity: string;
  quantity: string;
};

function toReceivableRow(
  line: PurchaseOrderDetailLine,
): Omit<ReceiveDialogRow, "quantity"> | null {
  if (!line.id) return null;

  return {
    lineId: line.id,
    itemName: line.itemName,
    unitName: line.purchaseUnitName,
    quantityOrdered: line.quantityOrdered,
    quantityReceived: line.quantityReceived,
    remainingQuantity: line.quantityRemaining,
  };
}
