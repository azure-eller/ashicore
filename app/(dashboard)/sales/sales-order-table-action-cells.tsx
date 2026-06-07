"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useState } from "react";
import type { FulfillmentDisplayState } from "@/lib/sales/fulfillment-status";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fulfillmentStatusBlockTone } from "@/components/fulfillment-status-block";
import {
  StatusDetailMenuTable,
  type StatusDetailMenuTableRow,
} from "@/components/status-detail-menu-table";
import { StatusBlock } from "@/components/ui/status-block";
import { formatDate } from "@/lib/format";
import {
  CreateManufacturingOrdersDialog,
  defaultManufacturingPlannedDate,
} from "./create-manufacturing-orders-dialog";
import type { SalesLinkedManufacturingOrder, SalesOrderListRow } from "./types";

export function StatusDetailCell({
  label,
  menuLabel,
  state,
  rows,
  emptyMessage,
  interactive = true,
}: {
  label: string;
  menuLabel: string;
  state: FulfillmentDisplayState;
  rows: StatusDetailMenuTableRow[];
  emptyMessage: string;
  interactive?: boolean;
}) {
  if (!interactive) {
    return (
      <StatusBlock
        tone={fulfillmentStatusBlockTone[state.tone]}
        aria-label={`${label}: ${state.label}`}
      >
        {state.label}
      </StatusBlock>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusBlock
          tone={fulfillmentStatusBlockTone[state.tone]}
          actionable
          actionVariant="button"
          onClick={(event) => event.stopPropagation()}
          aria-label={`${label}: ${state.label}`}
        >
          {state.label}
        </StatusBlock>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[560px]">
        <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
        <StatusDetailMenuTable emptyMessage={emptyMessage} rows={rows} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ingredientsStatusEmptyMessage(
  state: FulfillmentDisplayState,
  scope: "order" | "line"
) {
  if (state.label === "Not needed") return `Finished goods cover this ${scope}.`;
  if (state.label === "Not applicable") {
    return scope === "order"
      ? "No manufacturable items on this order."
      : "No manufacturable item on this line.";
  }
  return "No ingredient shortages.";
}

type ProductionActionCellProps = {
  order: SalesOrderListRow;
  state: FulfillmentDisplayState;
};

export function ProductionActionCell({ order, state }: ProductionActionCellProps) {
  return (
    <ProductionStatusCell
      state={state}
      salesOrderId={order.id}
      salesOrderStatus={order.status}
      salesOrderLabel={`${order.orderNumber} - ${order.customerName}`}
      shipDate={order.shipDate}
      openManufacturingOrders={order.openManufacturingOrders}
    />
  );
}

export function ProductionStatusCell({
  state,
  salesOrderId,
  salesOrderStatus,
  salesOrderLabel,
  shipDate,
  openManufacturingOrders,
}: {
  state: FulfillmentDisplayState;
  salesOrderId?: string;
  salesOrderStatus?: SalesOrderListRow["status"];
  salesOrderLabel?: string;
  shipDate?: string | null;
  openManufacturingOrders: SalesLinkedManufacturingOrder[];
}) {
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const [manufacturingStrategy, setManufacturingStrategy] =
    useState<"make_to_order" | "make_to_stock">("make_to_order");
  const isMakeAction = Boolean(salesOrderId) && salesOrderStatus === "open" && state.label === "Make";
  const hasOpenManufacturingOrders = openManufacturingOrders.length > 0;
  const tone = isMakeAction ? "muted" : fulfillmentStatusBlockTone[state.tone];

  if (!isMakeAction && !hasOpenManufacturingOrders) {
    return <StatusBlock tone={tone}>{state.label}</StatusBlock>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <StatusBlock
            suppressHydrationWarning
            actionable
            actionVariant="button"
            tone={tone}
            leadingIcon={isMakeAction ? Add01Icon : undefined}
            style={
              isMakeAction
                ? {
                    "--tone-bg": "var(--color-accent-soft)",
                    "--status-block-fg": "var(--color-accent-ink)",
                  } as CSSProperties
                : undefined
            }
            onClick={(event) => event.stopPropagation()}
            aria-label={`Production: ${state.label}`}
          >
            {state.label}
          </StatusBlock>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={hasOpenManufacturingOrders ? "w-[420px]" : "w-72"}
        >
          {isMakeAction ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  setManufacturingStrategy("make_to_order");
                  setMakeToOrderOpen(true);
                }}
                className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]"
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />
                Make to order
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setManufacturingStrategy("make_to_stock");
                  setMakeToOrderOpen(true);
                }}
                className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]"
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />
                Make to stock
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuLabel>Manufacturing orders</DropdownMenuLabel>
              {openManufacturingOrders.map((mo) => (
                <DropdownMenuItem key={mo.id} asChild className="py-(--space-4)">
                  <Link
                    href={`/manufacturing/order/${mo.id}`}
                    className="grid min-w-0 gap-(--space-1)"
                  >
                    <div className="truncate font-mono text-[length:var(--text-sm)] font-semibold">
                      {mo.orderNumber}
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-(--space-4) text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                      <span className="truncate">{mo.productName}</span>
                      <span className="font-mono tabular-nums">
                        {mo.plannedQuantity} {mo.unitName}
                      </span>
                    </div>
                    <div className="truncate font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                      Deadline {mo.plannedDate ? formatDate(mo.plannedDate) : "—"}
                    </div>
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {salesOrderId && salesOrderLabel ? (
        <CreateManufacturingOrdersDialog
          salesOrderId={salesOrderId}
          open={makeToOrderOpen}
          onOpenChange={setMakeToOrderOpen}
          showTrigger={false}
          manufacturingStrategy={manufacturingStrategy}
          salesOrderLabel={salesOrderLabel}
          initialPlannedDate={defaultManufacturingPlannedDate(shipDate ?? null)}
          openManufacturingOrders={openManufacturingOrders.map((mo) => ({
            id: mo.id,
            orderNumber: mo.orderNumber,
            itemName: mo.productName,
            quantity: `${mo.plannedQuantity} ${mo.unitName}`,
            plannedDate: mo.plannedDate,
            priorityRank: mo.priorityRank,
            status: mo.status,
          }))}
        />
      ) : null}
    </>
  );
}
