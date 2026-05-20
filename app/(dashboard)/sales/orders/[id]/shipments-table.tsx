"use client";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
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
  const total = order.shipments.length;
  const shipped = order.shipments.filter((s) => s.status === "shipped").length;
  const planned = total - shipped;

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
        <div className="rounded-none border border-[var(--color-line)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shipment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fulfillment</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Ship cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                {editable ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.shipments.map((shipment) => (
                <TableRow key={shipment.id}>
                  <TableCell className="font-mono text-xs">
                    {shipment.shipmentNumber}
                  </TableCell>
                  <TableCell>
                    <StatusLabel tone={shipmentStatusTone[shipment.status]}>
                      {shipment.status === "planned" ? "PLANNED" : "SHIPPED"}
                    </StatusLabel>
                  </TableCell>
                  <TableCell>
                    <div className={styles.fulfillmentCell}>
                      <div className={styles.fulfillmentType}>
                        {shipment.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
                      </div>
                      <div className={styles.fulfillmentRow}>
                        <span className={styles.fulfillmentLabel}>Ship</span>
                        <span className={styles.fulfillmentDate}>
                          {shipment.scheduledDate ? formatDate(shipment.scheduledDate) : "—"}
                        </span>
                      </div>
                      <div className={styles.fulfillmentRow}>
                        <span className={styles.fulfillmentLabel}>Deliv</span>
                        <span className={styles.fulfillmentDate}>
                          {shipment.deliveryDate ? formatDate(shipment.deliveryDate) : "—"}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ShipmentLinesList shipment={shipment} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPrice(shipment.marginSummary.productRevenue) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPrice(shipment.marginSummary.shipmentCosts) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <div className="font-semibold">
                      {shipment.marginSummary.contributionMargin
                        ? formatPrice(shipment.marginSummary.contributionMargin)
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {shipment.marginSummary.marginPercent
                        ? `${Number.parseFloat(shipment.marginSummary.marginPercent).toFixed(1)}%`
                        : "—"}
                    </div>
                  </TableCell>
                  {editable ? (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Actions for ${shipment.shipmentNumber}`}
                          >
                            <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {onEditShipment ? (
                            <DropdownMenuItem onSelect={() => onEditShipment(shipment)}>
                              Edit shipment
                            </DropdownMenuItem>
                          ) : null}
                          {onMarkShipped && shipment.status === "planned" ? (
                            <DropdownMenuItem onSelect={() => onMarkShipped(shipment)}>
                              Mark as shipped
                            </DropdownMenuItem>
                          ) : null}
                          {onEditCosts ? (
                            <DropdownMenuItem onSelect={() => onEditCosts(shipment)}>
                              Edit costs
                            </DropdownMenuItem>
                          ) : null}
                          {onPushXero ? (
                            <DropdownMenuItem onSelect={() => onPushXero(shipment)}>
                              Push invoice to Xero
                            </DropdownMenuItem>
                          ) : null}
                          {onDeleteShipment ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => onDeleteShipment(shipment)}
                                variant="destructive"
                              >
                                Delete shipment
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function ShipmentLinesList({ shipment }: { shipment: SalesShipmentRow }) {
  if (shipment.lines.length === 0) {
    return <span className="text-xs text-muted-foreground">No lines</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {shipment.lines.map((line) => (
        <div key={line.id} className="flex items-baseline gap-2 text-xs">
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
