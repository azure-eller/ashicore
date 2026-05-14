"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import {
  OperationalStateCell,
  type OperationalState,
} from "@/components/operational-state-cell";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";
import type {
  SalesOrderDetail,
  SalesOrderListRow,
} from "./types";

type ProductionActionCellProps = {
  order: SalesOrderListRow;
  state: OperationalState;
};

type ShipmentFormState = {
  fulfillmentType: "delivery" | "pickup";
  scheduledDate: string;
  notes: string;
  quantities: Record<string, string>;
};

function parseQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasPositiveQuantity(state: ShipmentFormState) {
  return Object.values(state.quantities).some((quantity) => {
    const parsed = Number.parseFloat(quantity);
    return Number.isFinite(parsed) && parsed > 0;
  });
}

function buildShipmentFormState(order: SalesOrderDetail): ShipmentFormState {
  return {
    fulfillmentType: "delivery",
    scheduledDate: order.shipDate ?? order.requestedDate ?? "",
    notes: "",
    quantities: Object.fromEntries(
      order.lines.map((line) => [
        line.id,
        parseQuantity(line.unplannedRemainingQuantity) > 0
          ? line.unplannedRemainingQuantity
          : "",
      ])
    ),
  };
}

function shipmentPayloadFromState(state: ShipmentFormState) {
  return {
    fulfillmentType: state.fulfillmentType,
    scheduledDate: state.scheduledDate || null,
    notes: state.notes || null,
    lines: Object.entries(state.quantities).flatMap(([salesOrderLineId, quantity]) => {
      const trimmed = quantity.trim();
      if (!trimmed) return [];

      const parsed = Number.parseFloat(trimmed);
      if (!Number.isFinite(parsed) || parsed <= 0) return [];

      return [{ salesOrderLineId, quantity: trimmed }];
    }),
  };
}

function latestPackedShipment(order: SalesOrderListRow | SalesOrderDetail) {
  return [...order.shipments]
    .filter((shipment) => shipment.status === "draft")
    .sort((left, right) => right.sequence - left.sequence)[0];
}

export function ProductionActionCell({ order, state }: ProductionActionCellProps) {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const isActionable =
    order.status !== "cancelled" &&
    order.status !== "shipped" &&
    order.hasManufacturableLines;

  if (!isActionable) {
    return <OperationalStateCell state={state} />;
  }

  return (
    <>
      <button
        type="button"
        className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          event.stopPropagation();
          setChoiceOpen(true);
        }}
        aria-label={
          state.label === "Make"
            ? "Create MOs"
            : `Production actions for ${order.orderNumber}`
        }
      >
        <OperationalStateCell
          state={state}
          className="transition-colors hover:border-primary/40 hover:bg-primary/10"
        />
      </button>

      <Dialog open={choiceOpen} onOpenChange={setChoiceOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Production</DialogTitle>
            <DialogDescription>
              {order.orderNumber} - {order.customerName}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Button
              type="button"
              className="justify-start"
              onClick={() => {
                setChoiceOpen(false);
                setMakeToOrderOpen(true);
              }}
            >
              Make to order
            </Button>
            <Button type="button" variant="outline" className="justify-start" asChild>
              <Link href="/manufacturing/orders/new">Make to stock</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreateManufacturingOrdersDialog
        salesOrderId={order.id}
        open={makeToOrderOpen}
        onOpenChange={setMakeToOrderOpen}
        showTrigger={false}
        salesOrderLabel={`${order.orderNumber} - ${order.customerName}`}
        initialPlannedDate={order.shipDate ?? order.requestedDate ?? undefined}
        openManufacturingOrders={order.openManufacturingOrders.map((mo) => ({
          id: mo.id,
          orderNumber: mo.orderNumber,
          itemName: mo.productName,
          quantity: `${mo.plannedQuantity} ${mo.unitName}`,
          plannedDate: mo.plannedDate,
          priorityRank: mo.priorityRank,
          status: mo.status,
        }))}
      />
    </>
  );
}

export function DeliveryActionCell({
  order,
  state,
}: {
  order: SalesOrderListRow;
  state: OperationalState;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const detailQuery = useQuery<SalesOrderDetail>({
    queryKey: ["sales-order", order.id],
    queryFn: () =>
      apiJson<SalesOrderDetail>(`/api/sales-orders/${order.id}`, {
        fallbackError: "Failed to load sales order.",
      }),
    enabled: menuOpen,
  });
  const detail = detailQuery.data ?? null;
  const [formState, setFormState] = useState<ShipmentFormState | null>(null);
  const activePackedShipment =
    (detail ? latestPackedShipment(detail) : latestPackedShipment(order)) ?? null;

  const resetAfterMutation = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-order", order.id] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    setFormState(null);
    router.refresh();
  };

  const requireDetail = () => {
    if (!detail) {
      throw new Error("Delivery details are still loading.");
    }

    return detail;
  };

  const createShipmentMutation = useMutation({
    mutationFn: async (state: ShipmentFormState) =>
      apiJson<{ id: string }>(`/api/sales-orders/${order.id}/shipments`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-shipment-table-create", {
          "Content-Type": "application/json",
        }),
        body: shipmentPayloadFromState(state),
        fallbackError: "Failed to pack shipment.",
      }),
    onSuccess: resetAfterMutation,
  });

  const shipShipmentMutation = useMutation({
    mutationFn: async (shipmentId: string) =>
      apiJson(`/api/sales-orders/${order.id}/shipments/${shipmentId}/ship`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-shipment-table-ship"),
        body: {},
        fallbackError: "Failed to mark shipment shipped.",
      }),
    onSuccess: resetAfterMutation,
  });

  const createAndShipMutation = useMutation({
    mutationFn: async (state: ShipmentFormState) => {
      const shipment = await apiJson<{ id: string }>(
        `/api/sales-orders/${order.id}/shipments`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("sales-shipment-table-create", {
            "Content-Type": "application/json",
          }),
          body: shipmentPayloadFromState(state),
          fallbackError: "Failed to pack shipment.",
        }
      );

      await apiJson(`/api/sales-orders/${order.id}/shipments/${shipment.id}/ship`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-shipment-table-ship"),
        body: {},
        fallbackError: "Failed to mark shipment shipped.",
      });
    },
    onSuccess: resetAfterMutation,
  });

  const activeError =
    createShipmentMutation.error ??
    shipShipmentMutation.error ??
    createAndShipMutation.error;
  const isMutating =
    createShipmentMutation.isPending ||
    shipShipmentMutation.isPending ||
    createAndShipMutation.isPending;
  const canOpen =
    order.status === "confirmed" ||
    order.status === "partially_shipped" ||
    order.status === "shipped";

  if (!canOpen) {
    return <OperationalStateCell state={state} />;
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
            aria-label={`Delivery actions for ${order.orderNumber}`}
          >
            <OperationalStateCell
              state={state}
              className="transition-colors hover:border-primary/40 hover:bg-primary/10"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Delivery status</DropdownMenuLabel>
          {detailQuery.isLoading ? (
            <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
          ) : detailQuery.isError ? (
            <DropdownMenuItem disabled>{detailQuery.error.message}</DropdownMenuItem>
          ) : detail ? (
            <>
              {activePackedShipment ? (
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Packed {activePackedShipment.shipmentNumber}
                  {activePackedShipment.scheduledDate
                    ? ` for ${formatDate(activePackedShipment.scheduledDate)}`
                    : ""}
                </DropdownMenuLabel>
              ) : (
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Nothing packed yet.
                </DropdownMenuLabel>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={detail.status === "shipped" || isMutating}
                onSelect={() =>
                  createShipmentMutation.mutate(buildShipmentFormState(requireDetail()))
                }
              >
                Pack all
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={detail.status === "shipped" || isMutating}
                onSelect={() => setFormState(buildShipmentFormState(requireDetail()))}
              >
                Pack custom...
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={detail.status === "shipped" || isMutating}
                onSelect={() => {
                  if (activePackedShipment) {
                    shipShipmentMutation.mutate(activePackedShipment.id);
                    return;
                  }

                  createAndShipMutation.mutate(buildShipmentFormState(requireDetail()));
                }}
              >
                {activePackedShipment ? "Deliver packed shipment" : "Deliver all"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/sales/orders/${order.id}`}>Open order</Link>
              </DropdownMenuItem>
            </>
          ) : null}
          {activeError ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-destructive">
                {activeError.message}
              </DropdownMenuLabel>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={formState != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setFormState(null);
        }}
      >
        <DialogContent
          size="3xl"
          className="max-h-[calc(100vh-2rem)] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Pack Shipment</DialogTitle>
            <DialogDescription>
              {order.orderNumber} - {order.customerName}
            </DialogDescription>
          </DialogHeader>

          {detail && formState ? (
            <div className="space-y-4">
              <div className="space-y-4 rounded-md border p-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Type</label>
                    <Select
                      value={formState.fulfillmentType}
                      onValueChange={(value) =>
                        setFormState({
                          ...formState,
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
                    <label className="text-sm font-medium">Scheduled Date</label>
                    <DatePicker
                      value={formState.scheduledDate}
                      onChange={(value) =>
                        setFormState({ ...formState, scheduledDate: value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Notes</label>
                  <Textarea
                    value={formState.notes}
                    onChange={(event) =>
                      setFormState({ ...formState, notes: event.target.value })
                    }
                    rows={2}
                  />
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead className="w-36 text-right">Pack</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            <div className="font-medium">{line.itemName}</div>
                            {line.itemSku ? (
                              <div className="text-xs text-muted-foreground">
                                {line.itemSku}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">
                            {line.unplannedRemainingQuantity} {line.unitName}
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label={`Shipment quantity for ${line.itemName}`}
                              inputMode="decimal"
                              value={formState.quantities[line.id] ?? ""}
                              onChange={(event) =>
                                setFormState({
                                  ...formState,
                                  quantities: {
                                    ...formState.quantities,
                                    [line.id]: event.target.value,
                                  },
                                })
                              }
                              className="text-right"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setFormState(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => createShipmentMutation.mutate(formState)}
                    disabled={isMutating || !hasPositiveQuantity(formState)}
                  >
                    {createShipmentMutation.isPending
                      ? "Saving..."
                      : "Save packed shipment"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ActionableStateCell({
  state,
  className,
}: {
  state: OperationalState;
  className?: string;
}) {
  return <OperationalStateCell state={state} className={cn(className)} />;
}
