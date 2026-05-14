"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { apiJson } from "@/lib/client/api";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

function readyShipmentCount(order: SalesOrderListRow | SalesOrderDetail) {
  return order.shipments.filter((shipment) => shipment.status === "draft").length;
}

function activeShipmentCount(order: SalesOrderListRow | SalesOrderDetail) {
  return order.shipments.filter((shipment) => shipment.status !== "cancelled").length;
}

function readyShipmentLabel(order: SalesOrderListRow | SalesOrderDetail) {
  const readyCount = readyShipmentCount(order);
  const activeCount = activeShipmentCount(order);

  if (readyCount > 0 && activeCount > 1) {
    return `Ready to ship (${readyCount}/${activeCount})`;
  }

  return "Ready to ship";
}

function hasFullyGroundAllocatedStock(order: SalesOrderListRow | SalesOrderDetail) {
  return (
    parseQuantity(order.fulfillmentSummary.remainingQty) > 0 &&
    parseQuantity(order.fulfillmentSummary.shortQty) <= 0 &&
    parseQuantity(order.fulfillmentSummary.productionAllocatedQty) <= 0
  );
}

function StateMenuItem({
  label,
  tone,
  disabled,
  onSelect,
}: {
  label: string;
  tone: OperationalState["tone"];
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const swatchClassName: Record<OperationalState["tone"], string> = {
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    secondary: "bg-primary",
    muted: "bg-muted-foreground/30",
  };

  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className="gap-3 py-2.5 text-lg"
    >
      <span
        aria-hidden
        className={cn("size-3 rounded-[2px]", swatchClassName[tone])}
      />
      {label}
    </DropdownMenuItem>
  );
}

export function ProductionActionCell({ order, state }: ProductionActionCellProps) {
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
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
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onSelect={() => setMakeToOrderOpen(true)}
            className="gap-3 py-2.5 text-lg"
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-5" />
            Make to order
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-3 py-2.5 text-lg">
            <Link href="/manufacturing/orders/new">
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-5" />
              Make to stock
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
  const activePackedShipment =
    (detail ? latestPackedShipment(detail) : latestPackedShipment(order)) ?? null;

  const resetAfterMutation = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-order", order.id] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
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
        fallbackError: "Failed to mark ready to ship.",
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
          fallbackError: "Failed to mark ready to ship.",
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
    order.status === "draft" ||
    order.status === "confirmed" ||
    order.status === "partially_shipped" ||
    order.status === "shipped";
  const canPrepareShipment =
    detail?.status === "confirmed" || detail?.status === "partially_shipped";
  const hasGroundAllocation = detail
    ? hasFullyGroundAllocatedStock(detail)
    : hasFullyGroundAllocatedStock(order);
  const canMarkReady =
    canPrepareShipment &&
    detail?.shippingReadiness.state === "ready" &&
    hasGroundAllocation &&
    activePackedShipment == null;
  const canMarkShipped =
    detail != null &&
    detail.status !== "shipped" &&
    (activePackedShipment != null ||
      (detail.shippingReadiness.state === "ready" && hasGroundAllocation));

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
        <DropdownMenuContent align="end" className="w-56">
          {detailQuery.isLoading ? (
            <DropdownMenuItem disabled className="py-2.5 text-lg">
              Loading...
            </DropdownMenuItem>
          ) : detailQuery.isError ? (
            <DropdownMenuItem disabled className="py-2.5 text-lg text-destructive">
              {detailQuery.error.message}
            </DropdownMenuItem>
          ) : detail ? (
            <>
              <StateMenuItem
                label="Not shipped"
                tone="muted"
                disabled
              />
              {detail.status === "partially_shipped" ? (
                <StateMenuItem
                  label="Partially shipped"
                  tone="warning"
                  disabled
                />
              ) : null}
              <StateMenuItem
                label={readyShipmentLabel(detail)}
                tone="success"
                disabled={!canMarkReady || isMutating}
                onSelect={() =>
                  createShipmentMutation.mutate(buildShipmentFormState(requireDetail()))
                }
              />
              <StateMenuItem
                label="Shipped"
                tone="success"
                disabled={!canMarkShipped || isMutating}
                onSelect={() => {
                  if (activePackedShipment) {
                    shipShipmentMutation.mutate(activePackedShipment.id);
                    return;
                  }

                  createAndShipMutation.mutate(buildShipmentFormState(requireDetail()));
                }}
              />
              {activeError ? (
                <DropdownMenuItem
                  disabled
                  className="py-2.5 text-lg text-destructive"
                >
                  {activeError.message}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
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
