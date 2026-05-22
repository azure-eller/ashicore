"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { StatusLabel, type StatusTone } from "@/components/ui/status-label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { CardSection } from "@/components/card-page/card-page";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { patchSalesShipment } from "@/lib/api/clients/sales-orders";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import { isValidIsoDate } from "@/lib/schemas/shared";
import type { SalesOrderDetail, SalesShipmentRow } from "@/app/(dashboard)/sales/types";

export type ShipmentsTableProps = {
  order: SalesOrderDetail;
  editable: boolean;
  addDisabledReason?: string | null;
  onNewShipment?: () => void;
  onEditShipment?: (shipment: SalesShipmentRow) => void;
  onMarkShipped?: (shipment: SalesShipmentRow) => void;
  onEditCosts?: (shipment: SalesShipmentRow) => void;
  onPushXero?: (shipment: SalesShipmentRow) => void;
  onDeleteShipment?: (shipment: SalesShipmentRow) => void;
};

const shipmentStatusTone: Record<SalesShipmentRow["status"], StatusTone> = {
  planned: "info",
  shipped: "success",
};

function shipmentToPayload(
  shipment: SalesShipmentRow,
  override: Partial<{
    fulfillmentType: "delivery" | "pickup";
    scheduledDate: string | null;
    deliveryDate: string | null;
  }>,
) {
  return {
    fulfillmentType: override.fulfillmentType ?? shipment.fulfillmentType,
    scheduledDate:
      override.scheduledDate !== undefined ? override.scheduledDate : shipment.scheduledDate,
    deliveryDate:
      override.deliveryDate !== undefined ? override.deliveryDate : shipment.deliveryDate,
    notes: shipment.notes,
    lines: shipment.lines.map((line) => ({
      salesOrderLineId: line.salesOrderLineId,
      quantity: line.quantity,
    })),
  };
}

export function ShipmentsTable({
  order,
  editable,
  addDisabledReason,
  onNewShipment,
  onEditShipment,
  onMarkShipped,
  onEditCosts,
  onPushXero,
  onDeleteShipment,
}: ShipmentsTableProps) {
  const queryClient = useQueryClient();
  const total = order.shipments.length;
  const shipped = order.shipments.filter((s) => s.status === "shipped").length;
  const planned = total - shipped;

  const patchMutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", order.id, "shipment-cell"),
    mutationFn: ({
      shipment,
      override,
    }: {
      shipment: SalesShipmentRow;
      override: Parameters<typeof shipmentToPayload>[1];
    }) => patchSalesShipment(order.id, shipment.id, shipmentToPayload(shipment, override)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", order.id] });
    },
  });

  // Only planned shipments are inline-editable; shipped ones are locked.
  const fields = useMemo<LineField<SalesShipmentRow>[]>(
    () => [
      {
        field: "shipmentNumber",
        kind: "display",
        headerName: "Shipment",
        flex: 1,
        minWidth: 200,
        mono: true,
        cellClass: "text-[length:var(--text-xs)]",
      },
      {
        field: "status",
        kind: "display",
        headerName: "Status",
        width: 130,
        cellRenderer: ({ data }: ICellRendererParams<SalesShipmentRow>) =>
          data ? (
            <StatusLabel tone={shipmentStatusTone[data.status]}>
              {data.status === "planned" ? "PLANNED" : "SHIPPED"}
            </StatusLabel>
          ) : null,
      },
      {
        field: "fulfillmentType",
        kind: "select",
        headerName: "Fulfillment",
        width: 130,
        editable: (data) => Boolean(data && editable && data.status === "planned"),
        values: ["delivery", "pickup"],
        valueFormatter: ({ value }) => (value === "pickup" ? "Pickup" : "Delivery"),
        valueSetter: (params: ValueSetterParams<SalesShipmentRow>) => {
          const next = params.newValue === "pickup" ? "pickup" : "delivery";
          if (next === params.data.fulfillmentType) return false;
          params.data.fulfillmentType = next;
          return true;
        },
      },
      {
        field: "scheduledDate",
        kind: "date",
        headerName: "Ship date",
        width: 130,
        editable: (data) => Boolean(data && editable && data.status === "planned"),
        mono: true,
        valueFormatter: ({ value }) => (value ? (formatDate(String(value)) ?? "—") : "—"),
        valueSetter: dateSetter("scheduledDate"),
      },
      {
        field: "deliveryDate",
        kind: "date",
        headerName: "Deliver date",
        width: 130,
        editable: (data) => Boolean(data && editable && data.status === "planned"),
        mono: true,
        valueFormatter: ({ value }) => (value ? (formatDate(String(value)) ?? "—") : "—"),
        valueSetter: dateSetter("deliveryDate"),
      },
      {
        colId: "lines",
        kind: "display",
        headerName: "Lines",
        flex: 1,
        minWidth: 220,
        autoHeight: true,
        cellRenderer: ({ data }: ICellRendererParams<SalesShipmentRow>) =>
          data ? <ShipmentLinesList shipment={data} /> : null,
      },
      {
        colId: "revenue",
        kind: "display",
        headerName: "Revenue",
        rightAligned: true,
        width: 120,
        mono: true,
        valueGetter: ({ data }) => data?.marginSummary.productRevenue ?? null,
        valueFormatter: ({ value }) => (value == null ? "—" : (formatPrice(String(value)) ?? "—")),
      },
      {
        colId: "shipCost",
        kind: "display",
        headerName: "Ship cost",
        rightAligned: true,
        width: 110,
        mono: true,
        valueGetter: ({ data }) => data?.marginSummary.shipmentCosts ?? null,
        valueFormatter: ({ value }) => (value == null ? "—" : (formatPrice(String(value)) ?? "—")),
      },
      {
        colId: "margin",
        kind: "display",
        headerName: "Margin",
        rightAligned: true,
        width: 120,
        cellRenderer: ({ data }: ICellRendererParams<SalesShipmentRow>) => {
          if (!data) return null;
          const m = data.marginSummary;
          return (
            <div className="flex flex-col items-end leading-tight py-(--space-1) font-mono tabular-nums">
              <span className="font-semibold">
                {m.contributionMargin ? (formatPrice(m.contributionMargin) ?? "—") : "—"}
              </span>
              <span className="text-[length:var(--text-xs)] text-muted-foreground">
                {m.marginPercent ? `${Number.parseFloat(m.marginPercent).toFixed(1)}%` : "—"}
              </span>
            </div>
          );
        },
      },
      {
        colId: "actions",
        kind: "display",
        headerName: "",
        width: 56,
        sortable: false,
        cellRenderer: ({ data }: ICellRendererParams<SalesShipmentRow>) =>
          data && editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${data.shipmentNumber}`}
                >
                  <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEditShipment ? (
                  <DropdownMenuItem onSelect={() => onEditShipment(data)}>
                    Edit shipment
                  </DropdownMenuItem>
                ) : null}
                {onMarkShipped && data.status === "planned" ? (
                  <DropdownMenuItem onSelect={() => onMarkShipped(data)}>
                    Mark as shipped
                  </DropdownMenuItem>
                ) : null}
                {onEditCosts ? (
                  <DropdownMenuItem onSelect={() => onEditCosts(data)}>
                    Edit costs
                  </DropdownMenuItem>
                ) : null}
                {onPushXero ? (
                  <DropdownMenuItem onSelect={() => onPushXero(data)}>
                    Push invoice to Xero
                  </DropdownMenuItem>
                ) : null}
                {onDeleteShipment && data.status === "planned" ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => onDeleteShipment(data)}
                      variant="destructive"
                    >
                      Delete shipment
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [editable, onEditShipment, onMarkShipped, onEditCosts, onPushXero, onDeleteShipment],
  );

  const handleRowsChange = (
    _rows: SalesShipmentRow[],
    change: EditableLineDataGridChange<SalesShipmentRow>,
  ) => {
    if (change.type !== "cell_edit_committed" || !change.row || !change.field) return;
    const shipment = change.row;
    if (change.field === "fulfillmentType") {
      patchMutation.mutate({
        shipment,
        override: { fulfillmentType: shipment.fulfillmentType },
      });
    } else if (change.field === "scheduledDate") {
      patchMutation.mutate({
        shipment,
        override: { scheduledDate: shipment.scheduledDate },
      });
    } else if (change.field === "deliveryDate") {
      patchMutation.mutate({
        shipment,
        override: { deliveryDate: shipment.deliveryDate },
      });
    }
  };

  return (
    <CardSection
      title="Shipments"
      count={`· ${shipped} of ${total} shipped · ${planned} planned`}
    >

      <MutableLines<SalesShipmentRow>
        rows={order.shipments}
        fields={fields}
        getRowId={(row) => row.id}
        createRow={() => order.shipments[0] as SalesShipmentRow}
        onRowsChange={handleRowsChange}
        addLabel="New shipment"
        readOnly={!editable || !onNewShipment}
        addDisabledReason={addDisabledReason}
        emptyMessage="No shipments planned."
        canDeleteRow={(row) => row.status === "planned"}
        getDeleteDisabledReason={(row) =>
          row.status === "planned" ? null : "Shipped shipments cannot be removed."
        }
        onDeleteRow={(row) => onDeleteShipment?.(row)}
        onAddRow={() => {
          onNewShipment?.();
          return null;
        }}
      />
    </CardSection>
  );
}

function dateSetter(field: "scheduledDate" | "deliveryDate") {
  return (params: ValueSetterParams<SalesShipmentRow>) => {
    const raw = String(params.newValue ?? "").trim();
    const next = raw === "" ? null : raw;
    if (next != null && !isValidIsoDate(next)) return false;
    if (next === params.data[field]) return false;
    params.data[field] = next;
    return true;
  };
}

function ShipmentLinesList({ shipment }: { shipment: SalesShipmentRow }) {
  if (shipment.lines.length === 0) {
    return <span className="text-[length:var(--text-xs)] text-muted-foreground">No lines</span>;
  }
  return (
    <div className="flex flex-col gap-1 py-(--space-1)">
      {shipment.lines.map((line) => (
        <div key={line.id} className="flex items-baseline gap-2 text-[length:var(--text-xs)]">
          <span className="font-mono tabular-nums min-w-[30px] text-right font-medium">
            {formatQuantity(line.quantity)}
          </span>
          <span className="inline-flex h-[15px] items-center px-[5px] bg-[var(--color-surface-sunk)] text-[var(--color-ink-2)] text-[9.5px] font-semibold uppercase tracking-[0.04em]">
            {line.unitName}
          </span>
          <span>{line.itemName}</span>
        </div>
      ))}
    </div>
  );
}
