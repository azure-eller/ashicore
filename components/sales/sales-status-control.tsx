"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  OrderStatusControl,
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
import { Input } from "@/components/ui/input";
import {
  shipSalesOrder,
  SalesOrderApiError,
} from "@/lib/api/clients/sales-orders";
import { deriveOrderDisplayStatus } from "@/lib/sales/order-display-status";
import { formatQuantity } from "@/lib/format";
import type {
  NegativeStockWarningPayload,
  SalesOrderDetail,
  SalesOrderListRow,
} from "@/app/(dashboard)/sales/types";

type SalesOrderForStatus = SalesOrderListRow | SalesOrderDetail;
type Ctx = { order: SalesOrderForStatus };

const OPTIONS: OrderStatusOption[] = [
  { value: "NOT SHIPPED", label: "Not shipped", tone: "neutral" },
  { value: "PARTIALLY SHIPPED", label: "Partially shipped", tone: "warning" },
  { value: "SHIPPED", label: "Shipped", tone: "success" },
];

const config: OrderStatusControlConfig<Ctx> = {
  type: "sales",
  options: () => OPTIONS,
  current: ({ order }) => deriveOrderDisplayStatus(order).label,
  transitionKind: (from, to) => {
    if (from === "SHIPPED") return "disabled";
    if (to === from) return "noop";
    if (to === "SHIPPED" || to === "PARTIALLY SHIPPED") return "dialog";
    return "disabled";
  },
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to === "SHIPPED") {
      return <ShipOrderDialog orderId={ctx.order.id} onClose={onClose} onDone={onDone} />;
    }
    if (to === "PARTIALLY SHIPPED") {
      return <PartialShipDialog order={ctx.order} onClose={onClose} onDone={onDone} />;
    }
    return null;
  },
};

function NegativeStockNotice({ items }: { items: NegativeStockWarningPayload[] }) {
  return (
    <div className="space-y-2 border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3">
      <p className="text-sm font-medium text-[var(--color-warning)]">
        This will drive stock negative:
      </p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {items.map((item) => (
          <li key={item.itemId}>
            {item.itemName}: short {formatQuantity(String(item.shortage))} (need{" "}
            {formatQuantity(String(item.requested))}, have {formatQuantity(String(item.available))})
          </li>
        ))}
      </ul>
    </div>
  );
}

function useShipMutation(run: (confirmNegativeStock: boolean) => Promise<void>, onDone: () => void) {
  const [warning, setWarning] = useState<NegativeStockWarningPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (confirmNegativeStock: boolean) => run(confirmNegativeStock),
    onSuccess: () => onDone(),
    onError: (err) => {
      if (err instanceof SalesOrderApiError && err.status === 409 && err.negativeStock) {
        setWarning(err.negativeStock);
        setError(null);
        return;
      }
      setWarning(null);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    },
  });
  return { mutation, warning, error };
}

function ShipOrderDialog({
  orderId,
  onClose,
  onDone,
}: {
  orderId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { mutation, warning, error } = useShipMutation(
    (confirm) => shipSalesOrder(orderId, confirm),
    onDone,
  );
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark order shipped?</DialogTitle>
          <DialogDescription>
            All remaining allocated quantity will be shipped and the order moves to its
            shipped state.
          </DialogDescription>
        </DialogHeader>
        {warning ? <NegativeStockNotice items={[warning]} /> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate(warning != null)} disabled={mutation.isPending}>
            {mutation.isPending ? "Shipping…" : warning ? "Ship anyway" : "Mark shipped"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function lineId(line: SalesOrderForStatus["lines"][number]) {
  return "id" in line && line.id ? line.id : "salesOrderLineId" in line ? line.salesOrderLineId : null;
}

function lineName(line: SalesOrderForStatus["lines"][number]) {
  return "itemName" in line ? line.itemName : line.masterName;
}

function lineRemaining(line: SalesOrderForStatus["lines"][number]) {
  return "remainingQuantity" in line
    ? line.remainingQuantity
    : line.remainingQty ?? "0";
}

function PartialShipDialog({
  order,
  onClose,
  onDone,
}: {
  order: SalesOrderForStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const remainingLines = order.lines
    .map((line) => ({
      id: lineId(line),
      name: lineName(line),
      sku: line.itemSku,
      unitName: line.unitName,
      remaining: lineRemaining(line),
      quantity: lineRemaining(line),
    }))
    .filter((line) => line.id != null && Number(line.remaining) > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        remainingLines.map((line) => [line.id as string, ""])
      )
  );
  const quantityError = (line: (typeof remainingLines)[number]) => {
    const quantity = quantities[line.id as string]?.trim() ?? "";
    if (quantity === "") return null;
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0) return "Enter a quantity greater than 0.";
    if (parsed > Number(line.remaining)) return `Max ${formatQuantity(line.remaining)}.`;
    return null;
  };
  const hasInvalidQuantity = remainingLines.some((line) => quantityError(line) != null);
  const selectedLines = remainingLines.flatMap((line) => {
    const quantity = quantities[line.id as string]?.trim() ?? "";
    const parsed = Number(quantity);
    if (quantityError(line) != null) return [];
    if (!Number.isFinite(parsed) || parsed <= 0) return [];
    return [{ salesOrderLineId: line.id as string, quantity }];
  });
  const { mutation, warning, error } = useShipMutation(
    (confirm) => shipSalesOrder(order.id, confirm, selectedLines),
    onDone,
  );

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Partially ship order</DialogTitle>
          <DialogDescription>
            Enter the quantity shipping now. Remaining demand stays open.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-auto border border-border">
          {remainingLines.map((line) => (
            <div
              key={line.id}
              className="grid grid-cols-[1fr_7rem] gap-(--space-8) border-b border-border p-(--space-8) last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {line.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatQuantity(line.remaining)} {line.unitName} remaining
                  {line.sku ? ` · ${line.sku}` : ""}
                </p>
              </div>
              <div className="space-y-(--space-2)">
                <Input
                  value={quantities[line.id as string] ?? ""}
                  inputMode="decimal"
                  placeholder={formatQuantity(line.remaining) ?? ""}
                  aria-label={`Quantity to ship for ${line.name}`}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id as string]: event.target.value,
                    }))
                  }
                />
                {quantityError(line) ? (
                  <p className="text-xs text-destructive">{quantityError(line)}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {warning ? <NegativeStockNotice items={[warning]} /> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate(warning != null)}
            disabled={mutation.isPending || selectedLines.length === 0 || hasInvalidQuantity}
          >
            {mutation.isPending ? "Shipping..." : warning ? "Ship anyway" : "Ship selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SalesStatusControl({
  order,
  size = "md",
  onChanged,
}: {
  order: SalesOrderForStatus;
  size?: "sm" | "md";
  onChanged?: () => void;
}) {
  const current = deriveOrderDisplayStatus(order).label;
  return (
    <OrderStatusControl
      config={config}
      ctx={{ order }}
      size={size}
      disabled={current === "SHIPPED"}
      onChanged={onChanged}
    />
  );
}
