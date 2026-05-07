"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import {
  AccountingSyncDialog,
  AccountingSyncStatus,
  buildAccountingSyncStages,
  type AccountingSyncDocument,
  type AccountingSyncStage,
} from "@/components/accounting-sync-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailPageActions } from "@/components/detail-page-actions";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  ACTUAL_MARGIN_TOOLTIP,
  ESTIMATED_MARGIN_TOOLTIP,
  SALES_LINE_QTY_TOOLTIP,
  SALES_UNIT_PRICE_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  LINE_COGS_TOOLTIP,
} from "@/lib/tooltip-copy";
import {
  formatAddressLines,
  formatDate,
  formatDateTime,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import { cn } from "@/lib/utils";
import {
  SALES_SHIPMENT_COST_STATUSES,
  SALES_SHIPMENT_COST_TYPES,
  type SalesShipmentCostStatus,
  type SalesShipmentCostType,
} from "@/lib/schemas/sales-orders";
import { ManufacturingOrderStatusBadge } from "@/app/(dashboard)/manufacturing/status-badge";
import { SalesOrderStatusBadge } from "./status-badge";
import {
  OVERSELL_WARNING_DESCRIPTION,
  OversellWarningTable,
} from "./oversell-warning-table";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";
import type {
  OversellWarningPayload,
  SalesOrderDetail as SalesOrderDetailType,
  SalesMarginSummary,
  SalesShipmentRow,
} from "./types";

type ActionError = {
  status?: number;
  error?: string;
  oversell?: OversellWarningPayload;
};

function formatMarginPercent(value: string | null | undefined) {
  return value == null ? "\u2014" : `${value}%`;
}

type ShipmentFormState = {
  shipmentId: string | null;
  idempotencyKey: string;
  fulfillmentType: "delivery" | "pickup";
  scheduledDate: string;
  notes: string;
  quantities: Record<string, string>;
};

type ShipmentActionPayload = {
  shipmentId: string;
  idempotencyKey: string;
};

type ShipmentCostFormLine = {
  costType: SalesShipmentCostType;
  costStatus: SalesShipmentCostStatus;
  amount: string;
  vendorName: string;
  referenceNumber: string;
  incurredDate: string;
  notes: string;
};

type ShipmentCostFormState = {
  shipmentId: string;
  customerFreightChargeAmount: string;
  costs: ShipmentCostFormLine[];
};

const COST_TYPE_LABELS: Record<SalesShipmentCostType, string> = {
  freight: "Freight",
  delivery_labor: "Delivery labor",
  fuel: "Fuel",
  packaging: "Packaging",
  accessorial: "Accessorial",
  other: "Other",
};

const COST_STATUS_LABELS: Record<SalesShipmentCostStatus, string> = {
  estimated: "Estimated",
  actual: "Actual",
};

function marginStatusLabel(status: SalesMarginSummary["costStatus"]) {
  if (status === "actual") return "Actual";
  if (status === "estimated") return "Estimated";
  if (status === "mixed") return "Mixed";
  return "Unknown";
}

function emptyShipmentCostLine(): ShipmentCostFormLine {
  return {
    costType: "freight",
    costStatus: "estimated",
    amount: "",
    vendorName: "",
    referenceNumber: "",
    incurredDate: "",
    notes: "",
  };
}

function buildShipmentFormState(
  order: SalesOrderDetailType,
  shipment?: SalesShipmentRow
): ShipmentFormState {
  const quantities: Record<string, string> = {};
  order.lines.forEach((line) => {
    quantities[line.id] = shipment
      ? (shipment.lines.find((shipmentLine) => shipmentLine.salesOrderLineId === line.id)
          ?.quantity ?? "")
      : line.unplannedRemainingQuantity;
  });

  return {
    shipmentId: shipment?.id ?? null,
    idempotencyKey: `sales-shipment-${shipment ? "update" : "create"}:${crypto.randomUUID()}`,
    fulfillmentType: shipment?.fulfillmentType ?? "delivery",
    scheduledDate: shipment?.scheduledDate ?? order.shipDate ?? "",
    notes: shipment?.notes ?? "",
    quantities,
  };
}

function buildShipmentCostFormState(shipment: SalesShipmentRow): ShipmentCostFormState {
  return {
    shipmentId: shipment.id,
    customerFreightChargeAmount: shipment.customerFreightChargeAmount ?? "",
    costs:
      shipment.costs.length > 0
        ? shipment.costs.map((cost) => ({
            costType: cost.costType,
            costStatus: cost.costStatus,
            amount: cost.amount,
            vendorName: cost.vendorName ?? "",
            referenceNumber: cost.referenceNumber ?? "",
            incurredDate: cost.incurredDate ?? "",
            notes: cost.notes ?? "",
          }))
        : [emptyShipmentCostLine()],
  };
}

function shipmentPayloadFromState(state: ShipmentFormState) {
  return {
    fulfillmentType: state.fulfillmentType,
    scheduledDate: state.scheduledDate || null,
    notes: state.notes || null,
    lines: Object.entries(state.quantities).flatMap(([salesOrderLineId, quantity]) => {
      const trimmedQuantity = quantity.trim();
      if (!trimmedQuantity) return [];

      const parsedQuantity = Number(trimmedQuantity);
      if (Number.isFinite(parsedQuantity) && parsedQuantity <= 0) return [];

      return [{ salesOrderLineId, quantity: trimmedQuantity }];
    }),
  };
}

function shipmentCostsPayloadFromState(state: ShipmentCostFormState) {
  return {
    customerFreightChargeAmount:
      state.customerFreightChargeAmount.trim() === ""
        ? null
        : state.customerFreightChargeAmount.trim(),
    costs: state.costs
      .filter((cost) => cost.amount.trim() !== "")
      .map((cost) => ({
        costType: cost.costType,
        costStatus: cost.costStatus,
        amount: cost.amount.trim(),
        vendorName: cost.vendorName.trim() || null,
        referenceNumber: cost.referenceNumber.trim() || null,
        incurredDate: cost.incurredDate || null,
        notes: cost.notes.trim() || null,
      })),
  };
}

function hasPositiveQuantity(state: ShipmentFormState | null) {
  if (!state) return false;
  return Object.values(state.quantities).some((value) => Number(value) > 0);
}

type SyncDialogState = {
  title: string;
  description: string;
  stages: AccountingSyncStage[];
  error: string | null;
  isWorking: boolean;
  documentNumber?: string | null;
  showProviderAction?: boolean;
};

async function fetchSalesOrderDetail(id: string): Promise<SalesOrderDetailType> {
  const response = await fetch(`/api/sales-orders/${id}`);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error ?? "Failed to refresh sales order.");
  }

  return body as SalesOrderDetailType;
}

function salesOrderAccountingDocument(
  order: SalesOrderDetailType
): AccountingSyncDocument {
  return {
    providerName: "Xero",
    documentLabel: "invoice",
    documentNumber: order.xeroInvoiceNumber,
    pushStatus: order.xeroPushStatus,
    pushError: order.xeroPushError,
    pushedAt: order.xeroPushedAt,
    retryCount: order.xeroRetryCount,
    emailStatus: order.xeroEmailStatus,
    emailError: order.xeroEmailError,
    emailedAt: order.xeroEmailedAt,
    emailProviderName: "Resend",
    recipientLabel: order.customerName,
    recipientEmail: order.customerEmail,
  };
}

type SalesOrderDetailTab =
  | "lines"
  | "shipping"
  | "financials"
  | "manufacturing"
  | "activity";

type SalesOrderTabConfig = {
  value: SalesOrderDetailTab;
  label: string;
  count?: ReactNode;
};

function normalizeSalesOrderDetailTab(value: string | null | undefined) {
  if (
    value === "lines" ||
    value === "shipping" ||
    value === "financials" ||
    value === "manufacturing" ||
    value === "activity"
  ) {
    return value;
  }

  return "lines";
}

function getInitialSalesOrderDetailTab(fallback: SalesOrderDetailTab = "lines") {
  if (typeof window === "undefined") return fallback;
  const hashTab = window.location.hash.replace("#", "");
  return hashTab ? normalizeSalesOrderDetailTab(hashTab) : fallback;
}

function selectHashTab(tab: SalesOrderDetailTab) {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", `${window.location.pathname}#${tab}`);
}

function money(value: string | null | undefined) {
  return formatPrice(value) ?? "\u2014";
}

function negativeMoney(value: string | null | undefined) {
  if (value == null) return "\u2014";
  const parsed = Number(value);
  const absolute = Number.isFinite(parsed) ? Math.abs(parsed).toString() : value;
  const formatted = formatPrice(absolute);
  return formatted ? `\u2212 ${formatted}` : "\u2014";
}

function marginToneClass(value: string | null | undefined) {
  const parsed = value == null ? NaN : Number(value);
  if (!Number.isFinite(parsed)) return "text-muted-foreground";
  if (parsed < 0) return "text-destructive";
  if (parsed > 0) return "text-success";
  return "text-muted-foreground";
}

function sumNumeric(values: Array<string | null | undefined>) {
  return values.reduce((total, value) => {
    const parsed = value == null ? NaN : Number(value);
    return Number.isFinite(parsed) ? total + parsed : total;
  }, 0);
}

function lineMarginParts(
  line: SalesOrderDetailType["lines"][number],
  orderStatus: SalesOrderDetailType["status"]
) {
  const hasActualMargin = line.actualCogs != null;

  return {
    cogs: hasActualMargin ? line.actualCogs : line.estimatedCogs,
    grossProfit: hasActualMargin ? line.actualGrossProfit : line.estimatedGrossProfit,
    marginPercent: hasActualMargin
      ? line.actualMarginPercent
      : line.estimatedMarginPercent,
    statusLabel: hasActualMargin || orderStatus === "shipped" ? "Actual" : "Estimated",
  };
}

function SalesOrderDetailTabs({
  tabs,
  activeTab,
  onTabChange,
  panels,
}: {
  tabs: SalesOrderTabConfig[];
  activeTab: SalesOrderDetailTab;
  onTabChange: (tab: SalesOrderDetailTab) => void;
  panels: Record<SalesOrderDetailTab, ReactNode>;
}) {
  return (
    <>
      <nav
        className="flex gap-1 overflow-x-auto border-b"
        aria-label="Sales order detail sections"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.value;

          return (
            <button
              id={`sales-order-tab-${tab.value}`}
              key={tab.value}
              type="button"
              aria-current={isActive ? "page" : undefined}
              aria-controls={`sales-order-panel-${tab.value}`}
              className={cn(
                "inline-flex h-10 shrink-0 items-center border-b-2 px-4 text-sm font-medium transition-colors",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              onClick={() => onTabChange(tab.value)}
            >
              {tab.label}
              {tab.count != null ? (
                <span
                  className={cn(
                    "ml-1.5 rounded-full px-1.5 py-0.5 text-[0.7rem] font-medium",
                    isActive
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <section
        id={`sales-order-panel-${activeTab}`}
        className="py-5"
        aria-labelledby={`sales-order-tab-${activeTab}`}
      >
        {panels[activeTab]}
      </section>
    </>
  );
}

function KeyFactRows({
  order,
  canEdit,
}: {
  order: SalesOrderDetailType;
  canEdit: boolean;
}) {
  const shipToLines = formatAddressLines({
    line1: order.shipLine1,
    line2: order.shipLine2,
    city: order.shipCity,
    region: order.shipRegion,
    postcode: order.shipPostcode,
    country: order.shipCountry,
  });

  const rows: Array<{ label: string; value: ReactNode; highlight?: boolean }> = [
    {
      label: "Customer",
      value: (
        <>
          <span className="font-medium">{order.customerName}</span>
          {order.customerEmail ? (
            <span className="ml-1.5 text-muted-foreground">
              {"\u00b7"} {order.customerEmail}
            </span>
          ) : null}
        </>
      ),
    },
    {
      label: "Ship to",
      value:
        shipToLines.length > 0 ? (
          <span className="block text-muted-foreground">
            {shipToLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-warning">
            No address saved
            {canEdit ? (
              <>
                {" \u00b7 "}
                <Link
                  href={`/sales/orders/${order.id}/edit`}
                  className="underline underline-offset-4"
                >
                  Add address
                </Link>
              </>
            ) : null}
          </span>
        ),
    },
    {
      label: "Order date",
      value: formatDate(order.orderDate),
    },
    {
      label: "Ship by",
      value: formatDate(order.shipDate),
      highlight: true,
    },
    {
      label: "Delivery",
      value: formatDate(order.requestedDate),
    },
  ];

  return (
    <dl>
      {rows.map((row, index) => (
        <div
          key={row.label}
          className={cn(
            "grid gap-3 py-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]",
            index < rows.length - 1 && "border-b"
          )}
        >
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd className={cn("min-w-0", row.highlight && "font-semibold")}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CompactMarginReceipt({ margin }: { margin: SalesMarginSummary }) {
  const costStatus =
    margin.costStatus === "unknown"
      ? null
      : marginStatusLabel(margin.costStatus).toLowerCase();

  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between border-b py-2">
        <span className="text-xs text-muted-foreground">Revenue</span>
        <span className="font-mono tabular-nums">{money(margin.productRevenue)}</span>
      </div>
      <div className="flex items-baseline justify-between border-b py-2">
        <span className="text-xs text-muted-foreground">COGS</span>
        <span className="text-right font-mono tabular-nums text-muted-foreground">
          {negativeMoney(margin.productCogs)}
          {costStatus ? (
            <span className="ml-1.5 font-sans text-xs text-muted-foreground">
              {"\u00b7"} {costStatus}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex items-baseline justify-between border-b py-2">
        <span className="text-xs text-muted-foreground">Shipment costs</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {negativeMoney(margin.shipmentCosts)}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between border-t border-foreground pt-2.5">
        <span className="font-semibold">Contribution margin</span>
        <span className="text-right">
          <span className="font-mono text-base font-semibold tabular-nums">
            {money(margin.contributionMargin)}
          </span>
          <span
            className={cn(
              "ml-2 text-xs font-medium",
              marginToneClass(margin.marginPercent)
            )}
          >
            {formatMarginPercent(margin.marginPercent)}
          </span>
        </span>
      </div>
    </div>
  );
}

function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-6 py-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </div>
  );
}

function LinesPanel({
  order,
  canEdit,
}: {
  order: SalesOrderDetailType;
  canEdit: boolean;
}) {
  const totalQuantity = sumNumeric(order.lines.map((line) => line.quantity));
  const totalLineAmount = sumNumeric(order.lines.map((line) => line.lineTotal));
  const totalCogs = sumNumeric(
    order.lines.map((line) => lineMarginParts(line, order.status).cogs)
  );
  const totalProfit = sumNumeric(
    order.lines.map((line) => lineMarginParts(line, order.status).grossProfit)
  );
  const totalMarginPercent =
    totalLineAmount > 0 ? `${((totalProfit / totalLineAmount) * 100).toFixed(1)}%` : "\u2014";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {order.lines.length} {order.lines.length === 1 ? "line" : "lines"}{" "}
          {"\u00b7"}{" "}
          {formatQuantity(String(totalQuantity))} units
        </span>
        {canEdit ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/sales/orders/${order.id}/edit`}>Add line</Link>
          </Button>
        ) : null}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>
                <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Qty" tooltip={SALES_LINE_QTY_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Unit Price" tooltip={SALES_UNIT_PRICE_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Line Total" tooltip={LINE_TOTAL_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="COGS" tooltip={LINE_COGS_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">
                <TooltipHeader
                  label={order.status === "shipped" ? "Actual Margin" : "Est. Margin"}
                  tooltip={
                    order.status === "shipped"
                      ? ACTUAL_MARGIN_TOOLTIP
                      : ESTIMATED_MARGIN_TOOLTIP
                  }
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.map((line) => {
              const margin = lineMarginParts(line, order.status);

              return (
                <TableRow key={line.id}>
                  <TableCell>
                    <Link
                      href={itemDetailHref("product", line.itemId)}
                      className="font-medium hover:underline"
                    >
                      {line.itemName}
                    </Link>
                    <div className="text-xs text-muted-foreground">{line.unitName}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {line.itemSku ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatQuantity(line.quantity)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(line.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {money(line.lineTotal)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {money(margin.cogs)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(margin.grossProfit)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <div>{formatMarginPercent(margin.marginPercent)}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {margin.statusLabel}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell
                colSpan={2}
                className="text-xs font-medium uppercase text-muted-foreground"
              >
                Total
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatQuantity(String(totalQuantity))}
              </TableCell>
              <TableCell />
              <TableCell className="text-right font-mono tabular-nums">
                {money(String(totalLineAmount))}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                {money(String(totalCogs))}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {money(String(totalProfit))}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {totalMarginPercent}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

function ShippingPanel({
  order,
  canCreateShipment,
  canEdit,
  hasCancelledRemainingHistory,
  onCreateShipment,
  onEditShipment,
  onShipShipment,
  onCancelShipment,
  onEditCosts,
  shipShipmentPending,
  cancelShipmentPending,
}: {
  order: SalesOrderDetailType;
  canCreateShipment: boolean;
  canEdit: boolean;
  hasCancelledRemainingHistory: boolean;
  onCreateShipment: () => void;
  onEditShipment: (shipment: SalesShipmentRow) => void;
  onShipShipment: (shipment: SalesShipmentRow) => void;
  onCancelShipment: (shipment: SalesShipmentRow) => void;
  onEditCosts: (shipment: SalesShipmentRow) => void;
  shipShipmentPending: boolean;
  cancelShipmentPending: boolean;
}) {
  const shipToLines = formatAddressLines({
    line1: order.shipLine1,
    line2: order.shipLine2,
    city: order.shipCity,
    region: order.shipRegion,
    postcode: order.shipPostcode,
    country: order.shipCountry,
  });
  const preparedCount = order.shipments.filter(
    (shipment) => shipment.status !== "cancelled"
  ).length;
  const activeShipmentCount = preparedCount;

  return (
    <div className="space-y-3">
      {shipToLines.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-medium">No ship-to address saved</div>
            <div className="mt-1 text-warning/80">
              Address required before shipment can be marked shipped.
            </div>
          </div>
          {canEdit ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/sales/orders/${order.id}/edit`}>Add address</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {hasCancelledRemainingHistory ? (
        <div className="rounded-md border bg-muted px-4 py-3 text-sm text-muted-foreground">
          This order shipped partially; remaining quantities were cancelled.
        </div>
      ) : null}

      {order.shippingReadiness.blockers.length > 0 ? (
        <div className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          {order.shippingReadiness.blockers.map((blocker) => (
            <div key={blocker}>{blocker}</div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {preparedCount} of {activeShipmentCount} prepared
        </span>
        {canCreateShipment ? (
          <Button variant="outline" size="sm" onClick={onCreateShipment}>
            New shipment
          </Button>
        ) : null}
      </div>

      {order.shipments.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shipment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Ship Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.shipments.map((shipment) => (
                <TableRow key={shipment.id}>
                  <TableCell className="font-mono text-xs">
                    {shipment.shipmentNumber}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        shipment.status === "shipped"
                          ? "outline"
                          : shipment.status === "cancelled"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {shipment.status === "shipped"
                        ? "Shipped"
                        : shipment.status === "cancelled"
                          ? "Cancelled"
                          : "Draft"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {shipment.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
                  </TableCell>
                  <TableCell>{formatDate(shipment.scheduledDate)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {shipment.lines.map((line) => (
                        <span
                          key={line.id}
                          className="inline-flex min-w-0 flex-wrap items-center gap-1.5"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {formatQuantity(line.quantity)}
                          </span>
                          <Badge variant="secondary">{line.unitName}</Badge>
                          <span className="min-w-0 truncate">{line.itemName}</span>
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(shipment.marginSummary.productRevenue)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <div>{money(shipment.marginSummary.productCogs)}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {marginStatusLabel(shipment.marginSummary.costStatus)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(shipment.marginSummary.shipmentCosts)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <div>{money(shipment.marginSummary.contributionMargin)}</div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {formatMarginPercent(shipment.marginSummary.marginPercent)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {shipment.status !== "cancelled" ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              window.open(
                                `/api/sales-orders/${order.id}/shipments/${shipment.id}/bol`,
                                "_blank",
                                "noopener,noreferrer"
                              );
                            }}
                          >
                            View BOL
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditCosts(shipment)}
                          >
                            Costs
                          </Button>
                        </>
                      ) : null}
                      {shipment.status === "draft" ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onShipShipment(shipment)}
                            disabled={shipShipmentPending}
                          >
                            Ship
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditShipment(shipment)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onCancelShipment(shipment)}
                            disabled={cancelShipmentPending}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyPanel
          title="No shipments planned"
          description="Create a shipment when this order is ready for fulfillment."
        />
      )}
    </div>
  );
}

function FinancialsPanel({
  order,
  accountingStatus,
}: {
  order: SalesOrderDetailType;
  accountingStatus: ReactNode;
}) {
  const margin = order.marginSummary;
  const subtotalRevenue = sumNumeric([
    margin.productRevenue,
    margin.freightRecovery,
  ]);
  const subtotalCosts = sumNumeric([margin.productCogs, margin.shipmentCosts]);

  return (
    <div className="space-y-5">
      <div className="max-w-[30rem]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Order Margin
          </div>
          <Badge variant="secondary">{marginStatusLabel(margin.costStatus)}</Badge>
        </div>

        <div className="text-sm">
          <ReceiptLine label="Product revenue" value={money(margin.productRevenue)} />
          <ReceiptLine
            label="Freight recovered"
            value={money(margin.freightRecovery)}
            muted
          />
          <ReceiptDivider />
          <ReceiptLine
            label="Subtotal revenue"
            value={money(String(subtotalRevenue))}
            bold
          />

          <div className="h-4" />

          <ReceiptLine
            label="Product COGS"
            value={negativeMoney(margin.productCogs)}
            sub={marginStatusLabel(margin.costStatus).toLowerCase()}
          />
          <ReceiptLine
            label="Shipment costs"
            value={negativeMoney(margin.shipmentCosts)}
            muted
          />
          <ReceiptDivider />
          <ReceiptLine
            label="Subtotal costs"
            value={negativeMoney(String(subtotalCosts))}
            bold
          />

          <div className="mt-4 flex items-baseline justify-between border-y border-b-[3px] border-double border-foreground py-3">
            <span className="font-semibold">Contribution margin</span>
            <span className="text-right">
              <span className="font-mono text-lg font-semibold tabular-nums">
                {money(margin.contributionMargin)}
              </span>
              <div
                className={cn(
                  "text-xs font-medium",
                  marginToneClass(margin.marginPercent)
                )}
              >
                {formatMarginPercent(margin.marginPercent)} of revenue
              </div>
            </span>
          </div>

          <div className="mt-4 text-xs leading-5 text-muted-foreground">
            COGS is estimated until fulfillment records actual lot cost.
            <br />
            Shipment costs firm up as costs are entered.
          </div>
        </div>
      </div>

      {accountingStatus}
    </div>
  );
}

function ReceiptLine({
  label,
  value,
  sub,
  bold,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span
        className={cn(
          muted ? "text-muted-foreground" : "text-foreground",
          bold && "font-semibold"
        )}
      >
        {label}
      </span>
      <span className="text-right">
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            muted && "text-muted-foreground",
            bold && "font-semibold text-foreground"
          )}
        >
          {value}
        </span>
        {sub ? (
          <span className="ml-1.5 text-xs text-muted-foreground">{sub}</span>
        ) : null}
      </span>
    </div>
  );
}

function ReceiptDivider() {
  return <div className="my-1 border-t border-dashed border-muted-foreground/40" />;
}

function ManufacturingPanel({
  order,
}: {
  order: SalesOrderDetailType;
}) {
  if (order.linkedManufacturingOrders.length === 0) {
    const hasManufacturableLines = order.manufacturableLineCount > 0;

    return (
      <EmptyPanel
        title={
          hasManufacturableLines
            ? "No manufacturing orders created yet"
            : "No manufacturing required"
        }
        description={
          hasManufacturableLines
            ? `${order.manufacturableLineCount} manufacturable ${
                order.manufacturableLineCount === 1 ? "line" : "lines"
              } can be sent to production.`
            : "All line items are stocked."
        }
      />
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>MO</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">
              <TooltipHeader label="Qty" tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP} />
            </TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.linkedManufacturingOrders.map((manufacturingOrder) => (
            <TableRow key={manufacturingOrder.id}>
              <TableCell className="font-mono text-xs">
                {manufacturingOrder.orderNumber}
              </TableCell>
              <TableCell>
                <ManufacturingOrderStatusBadge status={manufacturingOrder.status} />
              </TableCell>
              <TableCell>
                <div className="font-medium">{manufacturingOrder.productName}</div>
                {manufacturingOrder.productSku ? (
                  <div className="font-mono text-xs text-muted-foreground">
                    {manufacturingOrder.productSku}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatQuantity(manufacturingOrder.plannedQuantity)}{" "}
                {manufacturingOrder.unitName}
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/manufacturing/orders/${manufacturingOrder.id}`}>
                    Open
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ActivityPanel({ order }: { order: SalesOrderDetailType }) {
  const events = [
    {
      timestamp: order.updatedAt,
      actor: "System",
      action: "Order updated",
      detail: `Status is ${order.status.replace(/_/g, " ")}.`,
    },
    {
      timestamp: order.createdAt,
      actor: "System",
      action: "Order created",
      detail: `${order.orderNumber} created for ${order.customerName}.`,
    },
  ];

  return (
    <div className="max-w-3xl">
      {events.map((event) => (
        <div
          key={`${event.action}-${event.timestamp}`}
          className="flex gap-4 border-b py-3"
        >
          <div className="w-[140px] shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {formatDateTime(event.timestamp)}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <div>
              <span className="font-medium">{event.actor}</span>
              <span className="text-muted-foreground">
                {" "}
                {"\u00b7"} {event.action}
              </span>
            </div>
            <div className="mt-1 text-muted-foreground">{event.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function OrderDetail({
  order,
  canViewLedger = false,
}: {
  order: SalesOrderDetailType;
  canViewLedger?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelRemainingOpen, setCancelRemainingOpen] = useState(false);
  const [cancelRemainingIdempotencyKey, setCancelRemainingIdempotencyKey] =
    useState<string | null>(null);
  const [shipmentToShip, setShipmentToShip] = useState<SalesShipmentRow | null>(null);
  const [shipShipmentIdempotencyKey, setShipShipmentIdempotencyKey] =
    useState<string | null>(null);
  const [shipmentForm, setShipmentForm] = useState<ShipmentFormState | null>(null);
  const [shipmentCostForm, setShipmentCostForm] =
    useState<ShipmentCostFormState | null>(null);
  const [oversellWarning, setOversellWarning] =
    useState<OversellWarningPayload | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncDialog, setSyncDialog] = useState<SyncDialogState | null>(null);
  const accountingDocument = salesOrderAccountingDocument(order);
  const [activeTab, setActiveTab] = useState<SalesOrderDetailTab>(() =>
    getInitialSalesOrderDetailTab(order.shipments.length > 0 ? "shipping" : "lines")
  );

  const handleTabChange = (nextTab: SalesOrderDetailTab) => {
    setActiveTab(nextTab);
    selectHashTab(nextTab);
  };

  const openSyncDialog = ({
    title,
    description,
    localActionLabel,
    includeAccounting = true,
    includeEmail = true,
    activeStage = "push",
  }: {
    title: string;
    description: string;
    localActionLabel: string;
    includeAccounting?: boolean;
    includeEmail?: boolean;
    activeStage?: "push" | "email";
  }) => {
    setSyncDialog({
      title,
      description,
      stages: buildAccountingSyncStages({
        document: accountingDocument,
        includeAccounting,
        includeEmail,
        isWorking: true,
        localActionLabel,
        activeStage,
      }),
      error: null,
      isWorking: true,
      documentNumber: null,
      showProviderAction: false,
    });
  };

  const finishSyncDialog = async ({
    title,
    description,
    localActionLabel,
    includeAccounting = true,
    includeEmail = true,
  }: {
    title: string;
    description: string;
    localActionLabel: string;
    includeAccounting?: boolean;
    includeEmail?: boolean;
  }) => {
    try {
      const latest = await fetchSalesOrderDetail(order.id);
      const latestDocument = salesOrderAccountingDocument(latest);
      setSyncDialog({
        title,
        description,
        stages: buildAccountingSyncStages({
          document: latestDocument,
          includeAccounting,
          includeEmail,
          localActionLabel,
        }),
        error: null,
        isWorking: false,
        documentNumber: includeAccounting ? latestDocument.documentNumber : null,
        showProviderAction: includeAccounting && latestDocument.pushStatus === "pushed",
      });
    } catch {
      failSyncDialog({
        title,
        description,
        localActionLabel,
        message: "Failed to reload order status.",
      });
    }
  };

  const failSyncDialog = ({
    title,
    description,
    localActionLabel,
    message,
  }: {
    title: string;
    description: string;
    localActionLabel: string;
    message: string;
  }) => {
    setSyncDialog({
      title,
      description,
      stages: [
        {
          id: "local",
          label: localActionLabel,
          detail: message,
          state: "failed",
        },
      ],
      error: message,
      isWorking: false,
      documentNumber: null,
      showProviderAction: false,
    });
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "DELETE",
        headers: createIdempotencyHeaders("sales-order-delete"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.push("/sales/orders");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "PUT",
        headers: createIdempotencyHeaders("sales-order-cancel", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ status: "cancelled" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setCancelOpen(false);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const shipmentMutation = useMutation({
    mutationFn: async (values: ShipmentFormState) => {
      const isEdit = values.shipmentId != null;
      const response = await fetch(
        isEdit
          ? `/api/sales-orders/${order.id}/shipments/${values.shipmentId}`
          : `/api/sales-orders/${order.id}/shipments`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": values.idempotencyKey,
          },
          body: JSON.stringify(shipmentPayloadFromState(values)),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to save shipment.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setShipmentForm(null);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const shipmentCostMutation = useMutation({
    mutationFn: async (values: ShipmentCostFormState) => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${values.shipmentId}/costs`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(shipmentCostsPayloadFromState(values)),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to save shipment costs.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      setShipmentCostForm(null);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cancelShipmentMutation = useMutation({
    mutationFn: async ({ shipmentId, idempotencyKey }: ShipmentActionPayload) => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${shipmentId}`,
        {
          method: "DELETE",
          headers: { "Idempotency-Key": idempotencyKey },
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel shipment.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const shipShipmentMutation = useMutation({
    mutationFn: async ({ shipmentId, idempotencyKey }: ShipmentActionPayload) => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${shipmentId}/ship`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ sendEmail: false }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to ship shipment.");
      }
    },
    onMutate: () => {
      setActionError(null);
      openSyncDialog({
        title: "Shipping Shipment",
        description:
          "The shipment will be marked shipped. If this completes the order, the invoice will sync to Xero.",
        localActionLabel: "Mark shipment shipped",
        includeEmail: false,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);

      const latest = await fetchSalesOrderDetail(order.id);
      const latestDocument = salesOrderAccountingDocument(latest);
      const includeAccounting = latest.status === "shipped";
      setSyncDialog({
        title: includeAccounting ? "Shipment Complete" : "Shipment Recorded",
        description: includeAccounting
          ? "The order is shipped. The Xero invoice result is shown below."
          : "The shipment was marked shipped. Remaining quantities still need shipment.",
        stages: buildAccountingSyncStages({
          document: latestDocument,
          includeAccounting,
          includeEmail: false,
          localActionLabel: "Mark shipment shipped",
        }),
        error: null,
        isWorking: false,
        documentNumber: includeAccounting ? latestDocument.documentNumber : null,
        showProviderAction: includeAccounting && latestDocument.pushStatus === "pushed",
      });
      setShipmentToShip(null);
      setShipShipmentIdempotencyKey(null);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Shipment Failed",
        description: "The shipment was not marked shipped.",
        localActionLabel: "Mark shipment shipped",
        message: error.message,
      });
    },
  });

  const cancelRemainingMutation = useMutation({
    mutationFn: async () => {
      if (!cancelRemainingIdempotencyKey) {
        throw new Error("Open cancel remaining before confirming.");
      }

      const response = await fetch(`/api/sales-orders/${order.id}/cancel-remaining`, {
        method: "POST",
        headers: { "Idempotency-Key": cancelRemainingIdempotencyKey },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel remaining quantities.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setCancelRemainingOpen(false);
      setCancelRemainingIdempotencyKey(null);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (confirmOversell: boolean) => {
      const response = await fetch(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-order-confirm", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ confirmOversell }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to confirm order.",
          oversell: body?.oversell,
        } satisfies ActionError;
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setOversellWarning(null);
      router.refresh();
    },
    onError: (error: ActionError) => {
      if (error.status === 409 && error.oversell) {
        setOversellWarning(error.oversell);
        return;
      }

      setActionError(error.error ?? "Failed to confirm order.");
    },
  });

  const xeroPushMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}/xero-push`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to push invoice to Xero.");
      }
    },
    onMutate: () => {
      setActionError(null);
      openSyncDialog({
        title: "Syncing Invoice",
        description: "The invoice will be created or retried in Xero.",
        localActionLabel: "Start retry",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      await finishSyncDialog({
        title: "Invoice Sync Complete",
        description: "The latest Xero and email results are shown below.",
        localActionLabel: "Start retry",
      });
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Invoice Sync Failed",
        description: "The retry did not complete.",
        localActionLabel: "Start retry",
        message: error.message,
      });
    },
  });

  const xeroEmailMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/xero-email`,
        { method: "POST" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to email invoice.");
      }
    },
    onMutate: () => {
      setActionError(null);
      openSyncDialog({
        title: "Emailing Invoice",
        description: "Sending the existing invoice to the customer.",
        localActionLabel: "Prepare email",
        activeStage: "email",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      await finishSyncDialog({
        title: "Invoice Email Complete",
        description: "The latest email result is shown below.",
        localActionLabel: "Prepare email",
      });
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Invoice Email Failed",
        description: "The email retry did not complete.",
        localActionLabel: "Prepare email",
        message: error.message,
      });
    },
  });

  const onlineInvoiceMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/xero-online-invoice`
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to open online invoice.");
      }
      return body as { url: string };
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isDeleted = order.deletedAt != null;
  const canEdit = !isDeleted && order.status === "draft";
  const canConfirm = !isDeleted && order.status === "draft";
  const canCreateManufacturingOrders =
    !isDeleted &&
    (order.status === "confirmed" || order.status === "partially_shipped") &&
    order.hasManufacturableLines;
  const canCancelRemaining =
    !isDeleted &&
    (order.status === "confirmed" || order.status === "partially_shipped") &&
    order.lines.some((line) => Number(line.remainingQuantity) > 0);
  const canCancel = !isDeleted && order.status === "confirmed";
  const canDelete = !isDeleted;
  const canDownloadBol = order.status === "shipped";
  const canRetryXeroPush =
    order.status === "shipped" &&
    (order.xeroPushStatus === "failed" || order.xeroPushStatus === "pending");
  const canCreateXeroInvoice = order.status === "shipped" && !order.xeroPushStatus;
  const canSendXeroEmail =
    order.status === "shipped" &&
    order.xeroPushStatus === "pushed" &&
    order.xeroEmailStatus !== "sent";
  const xeroEmailActionLabel =
    order.xeroEmailStatus === "failed" ? "Retry Xero email" : "Email invoice";
  const canCreateShipment =
    !isDeleted &&
    (order.status === "confirmed" || order.status === "partially_shipped");
  const hasCancelledRemainingHistory =
    order.status === "cancelled" &&
    order.shipments.some((shipment) => shipment.status === "shipped");
  const tabs: SalesOrderTabConfig[] = [
    { value: "lines", label: "Line Items", count: order.lines.length },
    { value: "shipping", label: "Shipping", count: order.shipments.length },
    { value: "financials", label: "Financials" },
    {
      value: "manufacturing",
      label: "Manufacturing",
      count: order.linkedManufacturingOrders.length,
    },
    { value: "activity", label: "Activity" },
  ];
  const accountingStatus = canCreateXeroInvoice ? (
    <div className="flex max-w-3xl flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-card-foreground">
      <span className="font-medium">Accounting Sync</span>
      <Badge variant="secondary">Not synced</Badge>
      <span className="text-muted-foreground">Xero invoice</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => xeroPushMutation.mutate()}
        disabled={xeroPushMutation.isPending}
      >
        {xeroPushMutation.isPending ? "Creating..." : "Create invoice"}
      </Button>
    </div>
  ) : (
    <AccountingSyncStatus
      document={accountingDocument}
      onRetryPush={canRetryXeroPush ? () => xeroPushMutation.mutate() : undefined}
      retryPushPending={xeroPushMutation.isPending}
      onRetryEmail={canSendXeroEmail ? () => xeroEmailMutation.mutate() : undefined}
      retryEmailPending={xeroEmailMutation.isPending}
      providerAction={
        order.xeroPushStatus === "pushed"
          ? {
              label: "Open online invoice",
              onClick: () => onlineInvoiceMutation.mutate(),
              pending: onlineInvoiceMutation.isPending,
            }
          : undefined
      }
      compact
    />
  );

  const openCancelRemainingDialog = () => {
    setCancelRemainingIdempotencyKey(
      `sales-order-cancel-remaining:${crypto.randomUUID()}`
    );
    setCancelRemainingOpen(true);
  };

  const openShipShipmentDialog = (shipment: SalesShipmentRow) => {
    setShipmentToShip(shipment);
    setShipShipmentIdempotencyKey(`sales-shipment-ship:${crypto.randomUUID()}`);
  };

  return (
    <>
      <div className="mx-auto w-full max-w-7xl px-8 py-6">
        <div className="space-y-5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
            <Link href="/sales/orders" className="hover:text-foreground">
              Back to Orders
            </Link>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {order.orderNumber}
                </h1>
                <SalesOrderStatusBadge status={order.status} />
                <Badge
                  variant={
                    order.shippingReadiness.state === "ready"
                      ? "success"
                      : order.shippingReadiness.state === "shipped"
                        ? "outline"
                        : "secondary"
                  }
                >
                  {order.shippingReadiness.state === "ready" ? "\u25cf " : ""}
                  {order.shippingReadiness.message}
                </Badge>
                {isDeleted ? <Badge variant="outline">Deleted</Badge> : null}
              </div>
              {order.notes ? (
                <p className="max-w-3xl text-xs text-muted-foreground">
                  {order.notes}
                </p>
              ) : null}
            </div>

            <DetailPageActions
              editHref={canEdit ? `/sales/orders/${order.id}/edit` : undefined}
              menu={[
                ...(canViewLedger
                  ? [
                      {
                        label: "View inventory activity",
                        onSelect: () =>
                          router.push(
                            buildInventoryLedgerHref({
                              documentType: "sales_order",
                              documentId: order.id,
                            })
                          ),
                      },
                    ]
                  : []),
                ...(canDownloadBol
                  ? [
                      {
                        label: "View BOL",
                        onSelect: () => {
                          window.open(
                            `/api/sales-orders/${order.id}/bol`,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        },
                      },
                    ]
                  : []),
                ...(canRetryXeroPush
                  ? [
                      {
                        label: "Retry Xero push",
                        onSelect: () => xeroPushMutation.mutate(),
                        disabled: xeroPushMutation.isPending,
                      },
                    ]
                  : []),
                ...(canCreateXeroInvoice
                  ? [
                      {
                        label: "Create invoice",
                        onSelect: () => xeroPushMutation.mutate(),
                        disabled: xeroPushMutation.isPending,
                      },
                    ]
                  : []),
                ...(canSendXeroEmail
                  ? [
                      {
                        label: xeroEmailActionLabel,
                        onSelect: () => xeroEmailMutation.mutate(),
                        disabled: xeroEmailMutation.isPending,
                      },
                    ]
                  : []),
                ...(canCancel
                  ? [
                      {
                        label: "Cancel order",
                        onSelect: () => setCancelOpen(true),
                        disabled: cancelMutation.isPending,
                      },
                    ]
                  : []),
                ...(canDelete
                  ? [
                      {
                        label: "Delete",
                        onSelect: () => setDeleteOpen(true),
                        disabled: deleteMutation.isPending,
                        destructive: true,
                      },
                    ]
                  : []),
              ]}
            >
              {canCancelRemaining ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openCancelRemainingDialog}
                >
                  Cancel remaining
                </Button>
              ) : null}
              {canConfirm ? (
                <Button
                  size="sm"
                  onClick={() => confirmMutation.mutate(false)}
                  disabled={confirmMutation.isPending}
                >
                  {confirmMutation.isPending ? "Confirming..." : "Confirm"}
                </Button>
              ) : null}
              {canCreateShipment ? (
                <Button
                  size="sm"
                  onClick={() => setShipmentForm(buildShipmentFormState(order))}
                >
                  Ship
                </Button>
              ) : null}
              {canCreateManufacturingOrders ? (
                <CreateManufacturingOrdersDialog
                  salesOrderId={order.id}
                  initialOrder={order}
                  buttonVariant="outline"
                />
              ) : null}
            </DetailPageActions>
          </div>

          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

          <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
            <KeyFactRows order={order} canEdit={canEdit} />
            <CompactMarginReceipt margin={order.marginSummary} />
          </div>

          <SalesOrderDetailTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            panels={{
              lines: <LinesPanel order={order} canEdit={canEdit} />,
              shipping: (
                <ShippingPanel
                  order={order}
                  canCreateShipment={canCreateShipment}
                  canEdit={canEdit}
                  hasCancelledRemainingHistory={hasCancelledRemainingHistory}
                  onCreateShipment={() =>
                    setShipmentForm(buildShipmentFormState(order))
                  }
                  onEditShipment={(shipment) =>
                    setShipmentForm(buildShipmentFormState(order, shipment))
                  }
                  onShipShipment={openShipShipmentDialog}
                  onCancelShipment={(shipment) =>
                    cancelShipmentMutation.mutate({
                      shipmentId: shipment.id,
                      idempotencyKey: `sales-shipment-cancel:${crypto.randomUUID()}`,
                    })
                  }
                  onEditCosts={(shipment) =>
                    setShipmentCostForm(buildShipmentCostFormState(shipment))
                  }
                  shipShipmentPending={shipShipmentMutation.isPending}
                  cancelShipmentPending={cancelShipmentMutation.isPending}
                />
              ),
              financials: (
                <FinancialsPanel order={order} accountingStatus={accountingStatus} />
              ),
              manufacturing: <ManufacturingPanel order={order} />,
              activity: <ActivityPanel order={order} />,
            }}
          />
        </div>
      </div>

      <Dialog
        open={shipmentForm != null}
        onOpenChange={(open) => {
          if (!open) setShipmentForm(null);
        }}
      >
        <DialogContent size="3xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {shipmentForm?.shipmentId ? "Edit Shipment" : "Create Shipment"}
            </DialogTitle>
            <DialogDescription>
              The BOL is generated automatically from the saved shipment.
            </DialogDescription>
          </DialogHeader>
          {shipmentForm ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                shipmentMutation.mutate(shipmentForm);
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <Select
                    value={shipmentForm.fulfillmentType}
                    onValueChange={(value) =>
                      setShipmentForm({
                        ...shipmentForm,
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
                    value={shipmentForm.scheduledDate}
                    onChange={(value) =>
                      setShipmentForm({ ...shipmentForm, scheduledDate: value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  value={shipmentForm.notes}
                  onChange={(event) =>
                    setShipmentForm({ ...shipmentForm, notes: event.target.value })
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
                      <TableHead className="w-36 text-right">This Shipment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div>{line.itemName}</div>
                          {line.itemSku ? (
                            <div className="text-xs text-muted-foreground">
                              {line.itemSku}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">{line.quantity}</TableCell>
                        <TableCell className="text-right">{line.plannedQuantity}</TableCell>
                        <TableCell className="text-right">{line.shippedQuantity}</TableCell>
                        <TableCell className="text-right">
                          <QuantityWithUnit
                            value={line.unplannedRemainingQuantity}
                            unitName={line.unitName}
                            className="justify-end"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Shipment quantity for ${line.itemName}`}
                            inputMode="decimal"
                            value={shipmentForm.quantities[line.id] ?? ""}
                            onChange={(event) =>
                              setShipmentForm({
                                ...shipmentForm,
                                quantities: {
                                  ...shipmentForm.quantities,
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
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShipmentForm(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={shipmentMutation.isPending || !hasPositiveQuantity(shipmentForm)}
                >
                  {shipmentMutation.isPending ? "Saving..." : "Save Shipment"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={shipmentCostForm != null}
        onOpenChange={(open) => {
          if (!open) setShipmentCostForm(null);
        }}
      >
        <DialogContent size="3xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Costs & Margin</DialogTitle>
            <DialogDescription>
              Customer freight recovery is for margin tracking only. Not added to Xero
              invoices.
            </DialogDescription>
          </DialogHeader>
          {shipmentCostForm ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                shipmentCostMutation.mutate(shipmentCostForm);
              }}
            >
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="customer-freight-recovery">
                  Customer freight recovery
                </label>
                <Input
                  id="customer-freight-recovery"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={shipmentCostForm.customerFreightChargeAmount}
                  onChange={(event) =>
                    setShipmentCostForm({
                      ...shipmentCostForm,
                      customerFreightChargeAmount: event.target.value,
                    })
                  }
                />
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Incurred</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shipmentCostForm.costs.map((cost, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Select
                            value={cost.costType}
                            onValueChange={(value) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        costType: value as SalesShipmentCostType,
                                      }
                                    : entry
                                ),
                              })
                            }
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {SALES_SHIPMENT_COST_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {COST_TYPE_LABELS[type]}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={cost.costStatus}
                            onValueChange={(value) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        costStatus: value as SalesShipmentCostStatus,
                                      }
                                    : entry
                                ),
                              })
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {SALES_SHIPMENT_COST_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {COST_STATUS_LABELS[status]}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label="Shipment cost amount"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={cost.amount}
                            onChange={(event) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, amount: event.target.value }
                                    : entry
                                ),
                              })
                            }
                            className="w-28 text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label="Shipment cost vendor"
                            value={cost.vendorName}
                            onChange={(event) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, vendorName: event.target.value }
                                    : entry
                                ),
                              })
                            }
                            className="w-40"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label="Shipment cost reference"
                            value={cost.referenceNumber}
                            onChange={(event) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, referenceNumber: event.target.value }
                                    : entry
                                ),
                              })
                            }
                            className="w-36"
                          />
                        </TableCell>
                        <TableCell>
                          <DatePicker
                            value={cost.incurredDate}
                            onChange={(value) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, incurredDate: value }
                                    : entry
                                ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label="Shipment cost notes"
                            value={cost.notes}
                            onChange={(event) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, notes: event.target.value }
                                    : entry
                                ),
                              })
                            }
                            className="w-48"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs:
                                  shipmentCostForm.costs.length === 1
                                    ? [emptyShipmentCostLine()]
                                    : shipmentCostForm.costs.filter(
                                        (_entry, entryIndex) => entryIndex !== index
                                      ),
                              })
                            }
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setShipmentCostForm({
                      ...shipmentCostForm,
                      costs: [...shipmentCostForm.costs, emptyShipmentCostLine()],
                    })
                  }
                >
                  Add Cost
                </Button>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShipmentCostForm(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={shipmentCostMutation.isPending}>
                    {shipmentCostMutation.isPending ? "Saving..." : "Save Costs"}
                  </Button>
                </div>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      {syncDialog ? (
        <AccountingSyncDialog
          open
          title={syncDialog.title}
          description={syncDialog.description}
          stages={syncDialog.stages}
          error={syncDialog.error}
          isWorking={syncDialog.isWorking}
          stageActions={
            syncDialog.showProviderAction
              ? {
                  push: {
                    label: "Open online invoice",
                    onClick: () => onlineInvoiceMutation.mutate(),
                    pending: onlineInvoiceMutation.isPending,
                  },
                }
              : undefined
          }
          onOpenChange={(open) => {
            if (!open) setSyncDialog(null);
          }}
          onDone={() => setSyncDialog(null)}
        />
      ) : null}

      <AlertDialog open={oversellWarning != null} onOpenChange={(open) => {
        if (!open) {
          setOversellWarning(null);
        }
      }}>
        <AlertDialogContent size="2xl" className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
            <AlertDialogDescription>
              {OVERSELL_WARNING_DESCRIPTION}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <OversellWarningTable products={oversellWarning?.products ?? []} linkItems />

          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate(true)}
            >
              {confirmMutation.isPending ? "Confirming..." : "Confirm Anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will remain in history, but it will stop contributing to committed quantity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelRemainingOpen}
        onOpenChange={(open) => {
          setCancelRemainingOpen(open);
          if (!open) {
            setCancelRemainingIdempotencyKey(null);
          } else if (!cancelRemainingIdempotencyKey) {
            setCancelRemainingIdempotencyKey(
              `sales-order-cancel-remaining:${crypto.randomUUID()}`
            );
          }
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel remaining quantities?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft shipments will be cancelled and unshipped reservations released.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelRemainingMutation.isPending}
              onClick={() => cancelRemainingMutation.mutate()}
            >
              {cancelRemainingMutation.isPending ? "Cancelling..." : "Cancel Remaining"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={shipmentToShip != null}
        onOpenChange={(open) => {
          if (!open) {
            setShipmentToShip(null);
            setShipShipmentIdempotencyKey(null);
          } else if (!shipShipmentIdempotencyKey) {
            setShipShipmentIdempotencyKey(
              `sales-shipment-ship:${crypto.randomUUID()}`
            );
          }
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Ship this shipment?</AlertDialogTitle>
            <AlertDialogDescription>
              Inventory will be consumed. If this completes the order, the invoice will sync to Xero and email will not be sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={shipShipmentMutation.isPending}
              onClick={() => {
                if (!shipmentToShip || !shipShipmentIdempotencyKey) {
                  setActionError("Choose a shipment before shipping.");
                  return;
                }

                shipShipmentMutation.mutate({
                  shipmentId: shipmentToShip.id,
                  idempotencyKey: shipShipmentIdempotencyKey,
                });
              }}
            >
              {shipShipmentMutation.isPending ? "Shipping..." : "Ship Shipment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will be soft-deleted and removed from normal views while its saved line items remain in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
