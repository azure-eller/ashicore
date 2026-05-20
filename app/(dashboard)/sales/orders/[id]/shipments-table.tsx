"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColDef, ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
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
  EditableLineDataGrid,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { patchSalesShipment } from "@/lib/api/clients/sales-orders";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import { isValidIsoDate } from "@/lib/schemas/shared";
import type { SalesOrderDetail, SalesShipmentRow } from "@/app/(dashboard)/sales/types";
import cardStyles from "@/components/card-page/card-page.module.css";
import styles from "./order-card.module.css";

export type ShipmentsTableProps = {
  order: SalesOrderDetail;
  editable: boolean;
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
    mutationKey: ["sales-order", order.id, "patch-shipment"],
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
  const columns = useMemo<ColDef<SalesShipmentRow>[]>(
    () => [
      {
        field: "shipmentNumber",
        headerName: "Shipment",
        flex: 1,
        minWidth: 200,
        editable: false,
        cellClass: "font-mono text-[length:var(--text-xs)]",
      },
      {
        field: "status",
        headerName: "Status",
        width: 130,
        editable: false,
        cellRenderer: ({ data }: ICellRendererParams<SalesShipmentRow>) =>
          data ? (
            <StatusLabel tone={shipmentStatusTone[data.status]}>
              {data.status === "planned" ? "PLANNED" : "SHIPPED"}
            </StatusLabel>
          ) : null,
      },
      {
        field: "fulfillmentType",
        headerName: "Fulfillment",
        width: 130,
        editable: (params) => (params.data ? editable && params.data.status === "planned" : false),
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["delivery", "pickup"] },
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
        headerName: "Ship date",
        width: 130,
        editable: (params) => (params.data ? editable && params.data.status === "planned" : false),
        cellEditor: "agTextCellEditor",
        cellClass: "font-mono tabular-nums",
        valueFormatter: ({ value }) => (value ? (formatDate(String(value)) ?? "—") : "—"),
        valueSetter: dateSetter("scheduledDate"),
      },
      {
        field: "deliveryDate",
        headerName: "Deliver date",
        width: 130,
        editable: (params) => (params.data ? editable && params.data.status === "planned" : false),
        cellEditor: "agTextCellEditor",
        cellClass: "font-mono tabular-nums",
        valueFormatter: ({ value }) => (value ? (formatDate(String(value)) ?? "—") : "—"),
        valueSetter: dateSetter("deliveryDate"),
      },
      {
        colId: "lines",
        headerName: "Lines",
        flex: 1,
        minWidth: 220,
        editable: false,
        autoHeight: true,
        cellRenderer: ({ data }: ICellRendererParams<SalesShipmentRow>) =>
          data ? <ShipmentLinesList shipment={data} /> : null,
      },
      {
        colId: "revenue",
        headerName: "Revenue",
        type: "rightAligned",
        width: 120,
        editable: false,
        cellClass: "font-mono tabular-nums",
        valueGetter: ({ data }) => data?.marginSummary.productRevenue ?? null,
        valueFormatter: ({ value }) => (value == null ? "—" : (formatPrice(String(value)) ?? "—")),
      },
      {
        colId: "shipCost",
        headerName: "Ship cost",
        type: "rightAligned",
        width: 110,
        editable: false,
        cellClass: "font-mono tabular-nums",
        valueGetter: ({ data }) => data?.marginSummary.shipmentCosts ?? null,
        valueFormatter: ({ value }) => (value == null ? "—" : (formatPrice(String(value)) ?? "—")),
      },
      {
        colId: "margin",
        headerName: "Margin",
        type: "rightAligned",
        width: 120,
        editable: false,
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
    ],
    [editable],
  );

  const actionsColumn = useMemo<ColDef<SalesShipmentRow>[]>(
    () =>
      editable
        ? [
            {
              colId: "actions",
              headerName: "",
              width: 56,
              editable: false,
              sortable: false,
              cellRenderer: ({ data }: ICellRendererParams<SalesShipmentRow>) =>
                data ? (
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
          ]
        : [],
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
    <section className={cardStyles.section}>
      <div className="flex items-center gap-3 mb-3">
        <h2 className={cardStyles.sectionHeading} style={{ margin: 0 }}>
          Shipments
          <span className={cardStyles.count}>
            {shipped} of {total} shipped · {planned} planned
          </span>
        </h2>
        {editable && onNewShipment ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onNewShipment}
            className="ml-auto"
          >
            <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
            New shipment
          </Button>
        ) : null}
      </div>

      {order.shipments.length === 0 ? (
        <div className={styles.emptyState}>
          No shipments planned. Click{" "}
          <span className={styles.emptyStateStrong}>New shipment</span> to allocate inventory
          and plan fulfillment.
        </div>
      ) : (
        <EditableLineDataGrid<SalesShipmentRow>
          rows={order.shipments}
          columns={columns}
          getRowId={(row) => row.id}
          createRow={() => order.shipments[0]}
          onRowsChange={handleRowsChange}
          addLabel="New shipment"
          enableAddRow={false}
          enableReorder={false}
          enableDelete={false}
          extraEndColumns={actionsColumn}
          rowHeight={64}
          minHeight={120}
        />
      )}
    </section>
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
