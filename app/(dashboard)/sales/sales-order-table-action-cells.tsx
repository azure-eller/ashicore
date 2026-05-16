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

function latestPlannedShipment(order: SalesOrderListRow | SalesOrderDetail) {
  return [...order.shipments]
    .filter((shipment) => shipment.status === "planned")
    .sort((left, right) => right.sequence - left.sequence)[0];
}

function hasFullyGroundAllocatedStock(order: SalesOrderListRow | SalesOrderDetail) {
  return (
    parseQuantity(order.fulfillmentSummary.remainingQty) > 0 &&
    parseQuantity(order.fulfillmentSummary.shortQty) <= 0 &&
    parseQuantity(order.fulfillmentSummary.productionAllocatedQty) <= 0
  );
}

function shippedSalesQuantity(order: SalesOrderListRow | SalesOrderDetail) {
  return order.lines.reduce(
    (sum, line) => sum + parseQuantity(line.shippedQuantity),
    0
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
      className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]"
    >
      <span
        aria-hidden
        className={cn("size-(--space-4) rounded-(--radius-none)", swatchClassName[tone])}
      />
      {label}
    </DropdownMenuItem>
  );
}

export function ProductionActionCell({ order, state }: ProductionActionCellProps) {
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const isActionable =
    order.status === "open" &&
    state.label === "Make";

  if (!isActionable) {
    return <OperationalStateCell state={state} />;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            suppressHydrationWarning
            type="button"
            className="block w-full rounded-(--radius-none) outline-none focus-visible:shadow-[var(--focus-ring)]"
            onClick={(event) => event.stopPropagation()}
            aria-label={
              state.label === "Make"
                ? "Create MOs"
                : `Production actions for ${order.orderNumber}`
            }
          >
            <OperationalStateCell
              state={state}
              className="transition-colors hover:border-primary"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onSelect={() => setMakeToOrderOpen(true)}
            className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]"
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />
            Make to order
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]">
            <Link href="/manufacturing/orders/new">
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />
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
  const activePlannedShipment =
    (detail ? latestPlannedShipment(detail) : latestPlannedShipment(order)) ?? null;

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
          fallbackError: "Failed to plan shipment.",
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
    shipShipmentMutation.error ??
    createAndShipMutation.error;
  const isMutating =
    shipShipmentMutation.isPending ||
    createAndShipMutation.isPending;
  const canOpen = order.status === "open" || order.status === "done";
  const hasGroundAllocation = detail
    ? hasFullyGroundAllocatedStock(detail)
    : hasFullyGroundAllocatedStock(order);
  const canMarkShipped =
    detail != null &&
    detail.status === "open" &&
    (activePlannedShipment != null ||
      (detail.shippingReadiness.state === "ready" && hasGroundAllocation));

  if (!canOpen) {
    return <OperationalStateCell state={state} />;
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            suppressHydrationWarning
            type="button"
            className="block w-full rounded-(--radius-none) outline-none focus-visible:shadow-[var(--focus-ring)]"
            onClick={(event) => event.stopPropagation()}
            aria-label={`Delivery actions for ${order.orderNumber}`}
          >
            <OperationalStateCell
              state={state}
              className="transition-colors hover:border-primary"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {detailQuery.isLoading ? (
            <DropdownMenuItem disabled className="py-(--space-5) text-[length:var(--text-sm)]">
              Loading...
            </DropdownMenuItem>
          ) : detailQuery.isError ? (
            <DropdownMenuItem disabled className="py-(--space-5) text-[length:var(--text-sm)] text-destructive">
              {detailQuery.error.message}
            </DropdownMenuItem>
          ) : detail ? (
            <>
              <StateMenuItem
                label="Not shipped"
                tone="muted"
                disabled
              />
              {shippedSalesQuantity(detail) > 0 ? (
                <StateMenuItem
                  label="Partially shipped"
                  tone="warning"
                  disabled
                />
              ) : null}
              <StateMenuItem
                label="Shipped"
                tone="success"
                disabled={!canMarkShipped || isMutating}
                onSelect={() => {
                  if (activePlannedShipment) {
                    shipShipmentMutation.mutate(activePlannedShipment.id);
                    return;
                  }

                  createAndShipMutation.mutate(buildShipmentFormState(requireDetail()));
                }}
              />
              {activeError ? (
                <DropdownMenuItem
                  disabled
                  className="py-(--space-5) text-[length:var(--text-sm)] text-destructive"
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
