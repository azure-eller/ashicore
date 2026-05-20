"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { formatQuantity } from "@/lib/format";
import {
  clampShipmentQuantity,
  formatShipmentQuantityCapacity,
  getOrderDetailShipmentLineCapacity,
} from "@/app/(dashboard)/sales/shipment-quantity";
import type {
  SalesOrderDetail,
  SalesShipmentRow,
} from "@/app/(dashboard)/sales/types";

export type PlanShipmentDialogProps = {
  order: SalesOrderDetail;
  /** null = closed, "new" = create, SalesShipmentRow = edit existing */
  target: "new" | SalesShipmentRow | null;
  onClose: () => void;
};

type FormState = {
  fulfillmentType: "delivery" | "pickup";
  scheduledDate: string;
  deliveryDate: string;
  notes: string;
  quantities: Record<string, string>;
};

function makeFormState(
  target: "new" | SalesShipmentRow,
  order: SalesOrderDetail,
): FormState {
  if (target === "new") {
    return {
      fulfillmentType: "delivery",
      scheduledDate: order.shipDate ?? "",
      deliveryDate: order.requestedDate ?? order.shipDate ?? "",
      notes: "",
      quantities: {},
    };
  }
  const quantities: Record<string, string> = {};
  for (const line of target.lines) {
    quantities[line.salesOrderLineId] = line.quantity;
  }
  return {
    fulfillmentType: target.fulfillmentType,
    scheduledDate: target.scheduledDate ?? "",
    deliveryDate: target.deliveryDate ?? "",
    notes: target.notes ?? "",
    quantities,
  };
}

export function PlanShipmentDialog({ order, target, onClose }: PlanShipmentDialogProps) {
  const dialogOpen = target != null;
  // Remount the form when target identity changes so initial state stays in
  // sync without an effect that calls setState.
  const formKey =
    target == null
      ? "closed"
      : target === "new"
        ? "new"
        : `edit-${target.id}`;

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="3xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
        {target ? (
          <PlanShipmentDialogForm
            key={formKey}
            order={order}
            target={target}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PlanShipmentDialogForm({
  order,
  target,
  onClose,
}: {
  order: SalesOrderDetail;
  target: "new" | SalesShipmentRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => makeFormState(target, order));
  const editingShipmentId = target === "new" ? null : target.id;

  const mutation = useMutation({
    mutationKey: [
      "sales-order",
      order.id,
      "shipment",
      editingShipmentId ?? "new",
    ],
    mutationFn: async (state: FormState) => {
      const payload = {
        fulfillmentType: state.fulfillmentType,
        scheduledDate: state.scheduledDate || null,
        deliveryDate: state.deliveryDate || null,
        notes: state.notes.trim() === "" ? null : state.notes.trim(),
        lines: order.lines
          .map((line) => ({
            salesOrderLineId: line.id,
            quantity: state.quantities[line.id]?.trim() ?? "",
          }))
          .filter((line) => line.quantity !== ""),
      };
      const url = editingShipmentId
        ? `/api/sales-orders/${order.id}/shipments/${editingShipmentId}`
        : `/api/sales-orders/${order.id}/shipments`;
      const response = await fetch(url, {
        method: editingShipmentId ? "PATCH" : "POST",
        headers: createIdempotencyHeaders(
          editingShipmentId ? "patchSalesShipment" : "createSalesShipment",
          { "Content-Type": "application/json" },
        ),
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null as unknown);
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : "Failed to save shipment.";
        throw new Error(message);
      }
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["sales-order", order.id],
      });
      onClose();
    },
  });

  const isEdit = editingShipmentId != null;
  const hasPositiveQuantity = useMemo(() => {
    return Object.values(form.quantities).some((value) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) && parsed > 0;
    });
  }, [form]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit shipment" : "Plan shipment"}</DialogTitle>
        <DialogDescription>
          The bill of lading is generated automatically when the shipment
          ships.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(form);
        }}
      >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Fulfillment</label>
                <Select
                  value={form.fulfillmentType}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      fulfillmentType: value as "delivery" | "pickup",
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delivery">Delivery</SelectItem>
                    <SelectItem value="pickup">Pickup</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Ship date</label>
                <DatePicker
                  value={form.scheduledDate}
                  onChange={(value) =>
                    setForm({ ...form, scheduledDate: value ?? "" })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Delivery date</label>
                <DatePicker
                  value={form.deliveryDate}
                  onChange={(value) =>
                    setForm({ ...form, deliveryDate: value ?? "" })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
                rows={3}
              />
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Shipped</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="w-36 text-right">This shipment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lines.map((line) => {
                    const maxQuantity = getOrderDetailShipmentLineCapacity({
                      lineId: line.id,
                      unplannedRemainingQuantity: line.unplannedRemainingQuantity,
                      shipment: target && target !== "new"
                        ? { lines: target.lines }
                        : undefined,
                    });
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div>{line.itemName}</div>
                          {line.itemSku ? (
                            <div className="text-xs text-muted-foreground">
                              {line.itemSku}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(line.quantity)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(line.plannedQuantity)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(line.shippedQuantity)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(line.unplannedRemainingQuantity)}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={maxQuantity}
                            step="0.0001"
                            aria-label={`Shipment quantity for ${line.itemName}`}
                            value={form.quantities[line.id] ?? ""}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                quantities: {
                                  ...form.quantities,
                                  [line.id]: clampShipmentQuantity(
                                    event.target.value,
                                    maxQuantity,
                                  ),
                                },
                              })
                            }
                            className="text-right"
                          />
                          <div className="mt-1 text-xs text-muted-foreground">
                            Max {formatShipmentQuantityCapacity(maxQuantity)}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {mutation.isError ? (
              <div className="text-sm text-destructive">
                {(mutation.error as Error).message}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !hasPositiveQuantity}
              >
                {mutation.isPending
                  ? "Saving…"
                  : isEdit
                    ? "Save shipment"
                    : "Plan shipment"}
              </Button>
            </DialogFooter>
      </form>
    </>
  );
}
