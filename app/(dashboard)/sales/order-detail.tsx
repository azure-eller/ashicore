"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { getApiErrorMessage } from "@/lib/client/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Delete02Icon,
  HelpCircleIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  SALES_LINE_QTY_TOOLTIP,
  SALES_UNIT_PRICE_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  UNIT_COST_TOOLTIP,
  UNIT_MARGIN_TOOLTIP,
  ESTIMATED_ORDER_COGS_TOOLTIP,
  ESTIMATED_SHIPMENT_COSTS_TOOLTIP,
} from "@/lib/tooltip-copy";
import {
  formatAddressLines,
  formatDate,
  formatDateTime,
  normalizeMoney,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
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
import { buildSalesOrderLineRemovalPayload } from "./order-line-removal";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";
import type {
	  DraftAllocationTakeoverWarningPayload,
	  NegativeStockWarningPayload,
  SalesOrderDetail as SalesOrderDetailType,
  SalesMarginSummary,
  SalesShipmentRow,
} from "./types";

type ActionError = {
  status?: number;
  error?: string;
	  draftAllocationTakeover?: DraftAllocationTakeoverWarningPayload;
	  negativeStock?: NegativeStockWarningPayload;
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
  confirmNegativeStock?: boolean;
};

type ShipmentInvoiceActionPayload = {
  shipment: SalesShipmentRow;
  idempotencyKey: string;
};

type DeleteLineActionPayload = {
  lineId: string;
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
    customerFreightChargeAmount: null,
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
    emailStatus: null,
    emailError: null,
    emailedAt: null,
    emailProviderName: "Resend",
    recipientLabel: order.customerName,
    recipientEmail: order.customerEmail,
  };
}

type SalesOrderDetailTab =
  | "lines"
  | "shipping"
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

function EstimatedReceiptLabel({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex text-muted-foreground hover:text-foreground"
            aria-label={`${label} estimate note`}
          >
            <HugeiconsIcon icon={HelpCircleIcon} size={12} strokeWidth={2} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </span>
  );
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
  const unitCost = hasActualMargin ? line.actualUnitCost : line.estimatedUnitCost;
  const unitPrice = Number(line.unitPrice);
  const parsedUnitCost = unitCost == null ? NaN : Number(unitCost);
  const unitMargin =
    Number.isFinite(unitPrice) && Number.isFinite(parsedUnitCost)
      ? normalizeMoney(unitPrice - parsedUnitCost)
      : null;

  return {
    unitCost,
    unitMargin,
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
          <Link
            href={`/sales/customers/${order.customerId}`}
            className="font-medium hover:underline"
            aria-label={`Customer ${order.customerName}`}
          >
            {order.customerName}
          </Link>
          {order.customerEmail ? (
            <span className="ml-1.5 text-muted-foreground">
              {"\u00b7"} {order.customerEmail}
            </span>
          ) : null}
        </>
      ),
    },
    {
      label: "Project / Job",
      value: order.customerProjectId ? (
        <Link
          href={`/sales/customers/${order.customerId}?project=${order.customerProjectId}#projects`}
          className="font-medium hover:underline"
          aria-label={`Project ${order.customerProjectName ?? "Deleted project"}`}
        >
          {order.customerProjectName ?? "Deleted project"}
        </Link>
      ) : (
        <span className="text-muted-foreground">\u2014</span>
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
      label: "Shipping Date",
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
  const showsEstimatedCosts =
    margin.costStatus === "estimated" || margin.costStatus === "mixed";

  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between border-b py-2">
        <span className="text-xs text-muted-foreground">Product revenue</span>
        <span className="font-mono tabular-nums">{money(margin.productRevenue)}</span>
      </div>
      <div className="flex items-baseline justify-between border-b py-2">
        <span className="text-xs text-muted-foreground">
          {showsEstimatedCosts ? (
            <EstimatedReceiptLabel
              label="COGS"
              tooltip={ESTIMATED_ORDER_COGS_TOOLTIP}
            />
          ) : (
            "COGS"
          )}
        </span>
        <span className="text-right font-mono tabular-nums text-muted-foreground">
          {negativeMoney(margin.productCogs)}
        </span>
      </div>
      <div className="flex items-baseline justify-between border-b py-2">
        <span className="text-xs text-muted-foreground">
          {showsEstimatedCosts ? (
            <EstimatedReceiptLabel
              label="Shipment costs"
              tooltip={ESTIMATED_SHIPMENT_COSTS_TOOLTIP}
            />
          ) : (
            "Shipment costs"
          )}
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {negativeMoney(margin.shipmentCosts)}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between border-t border-foreground pt-2.5">
        <span className="font-semibold">Contribution margin</span>
        <span className="text-right">
          <div
            className={cn(
              "font-mono text-lg font-semibold tabular-nums",
              marginToneClass(margin.marginPercent)
            )}
          >
            {formatMarginPercent(margin.marginPercent)}
          </div>
          <div className="font-mono text-xs tabular-nums text-muted-foreground">
            {money(margin.contributionMargin)}
          </div>
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
  onDeleteLine,
  deletingLineId,
}: {
  order: SalesOrderDetailType;
  canEdit: boolean;
  onDeleteLine: (line: SalesOrderDetailType["lines"][number]) => void;
  deletingLineId: string | null;
}) {
  const totalQuantity = sumNumeric(order.lines.map((line) => line.quantity));
  const totalLineAmount = sumNumeric(order.lines.map((line) => line.lineTotal));
  const canRemoveLines = canEdit && order.lines.length > 1;

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
                <TooltipHeader label="Unit Cost" tooltip={UNIT_COST_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Unit Price" tooltip={SALES_UNIT_PRICE_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Unit Margin" tooltip={UNIT_MARGIN_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Line Total" tooltip={LINE_TOTAL_TOOLTIP} />
              </TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.map((line) => {
              const margin = lineMarginParts(line, order.status);

              return (
                <TableRow key={line.id} className="group/line">
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
                    {money(margin.unitCost)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(line.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <div
                      className={cn(
                        "font-semibold",
                        marginToneClass(margin.marginPercent)
                      )}
                    >
                      {formatMarginPercent(margin.marginPercent)}
                    </div>
                    <div className="font-sans text-xs text-muted-foreground">
                      {money(margin.unitMargin)} {"\u00b7"} {margin.statusLabel}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {money(line.lineTotal)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/line:opacity-100 focus-within:opacity-100">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              asChild
                            >
                              <Link
                                href={`/sales/orders/${order.id}/edit`}
                                aria-label={`Edit ${line.itemName}`}
                              >
                                <HugeiconsIcon
                                  icon={PencilEdit02Icon}
                                  size={14}
                                  strokeWidth={2}
                                />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Edit line</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              disabled={!canRemoveLines || deletingLineId === line.id}
                              aria-label={`Delete ${line.itemName}`}
                              onClick={() => onDeleteLine(line)}
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                size={14}
                                strokeWidth={2}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {canRemoveLines
                              ? "Delete line"
                              : "Order needs at least one line"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    ) : null}
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
              <TableCell />
              <TableCell />
              <TableCell className="text-right font-mono tabular-nums">
                {money(String(totalLineAmount))}
              </TableCell>
              <TableCell />
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
  canCreateOrderInvoice,
  canEdit,
  hasCancelledRemainingHistory,
  onCreateShipment,
  onCreateOrderInvoice,
  onEditShipment,
  onShipShipment,
  onCancelShipment,
  onEditCosts,
  onCreateShipmentInvoice,
  shipShipmentPending,
  cancelShipmentPending,
  createOrderInvoicePending,
  createShipmentInvoicePending,
}: {
  order: SalesOrderDetailType;
  canCreateShipment: boolean;
  canCreateOrderInvoice: boolean;
  canEdit: boolean;
  hasCancelledRemainingHistory: boolean;
  onCreateShipment: () => void;
  onCreateOrderInvoice: () => void;
  onEditShipment: (shipment: SalesShipmentRow) => void;
  onShipShipment: (shipment: SalesShipmentRow) => void;
  onCancelShipment: (shipment: SalesShipmentRow) => void;
  onEditCosts: (shipment: SalesShipmentRow) => void;
  onCreateShipmentInvoice: (shipment: SalesShipmentRow) => void;
  shipShipmentPending: boolean;
  cancelShipmentPending: boolean;
  createOrderInvoicePending: boolean;
  createShipmentInvoicePending: boolean;
}) {
  const shipToLines = formatAddressLines({
    line1: order.shipLine1,
    line2: order.shipLine2,
    city: order.shipCity,
    region: order.shipRegion,
    postcode: order.shipPostcode,
    country: order.shipCountry,
  });
  const shippedShipmentCount = order.shipments.filter(
    (shipment) => shipment.status === "shipped"
  ).length;
  const activeShipmentCount = order.shipments.filter(
    (shipment) => shipment.status !== "cancelled"
  ).length;

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
          <div className="font-medium text-foreground">
            Shipment planning is available; final shipping is blocked.
          </div>
          {order.shippingReadiness.blockers.map((blocker) => (
            <div key={blocker} className="mt-1">
              {blocker}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {shippedShipmentCount} of {activeShipmentCount} shipped
        </span>
        <div className="flex items-center gap-2">
          {canCreateOrderInvoice ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onCreateOrderInvoice}
              disabled={createOrderInvoicePending}
            >
              {createOrderInvoicePending ? "Creating..." : "Create invoice"}
            </Button>
          ) : null}
          {canCreateShipment ? (
            <Button variant="outline" size="sm" onClick={onCreateShipment}>
              New shipment
            </Button>
          ) : null}
        </div>
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
                          : "Ready to ship"}
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
                          {shipment.status === "shipped" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onCreateShipmentInvoice(shipment)}
                              disabled={createShipmentInvoicePending}
                            >
                              {shipment.xeroPushStatus === "pushed"
                                ? "Invoice created"
                                : "Create invoice"}
                            </Button>
                          ) : null}
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
            <TableHead>Link</TableHead>
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
                <Badge variant="secondary">
                  {formatManufacturingLinkSource(manufacturingOrder.linkSource)}
                </Badge>
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

function formatManufacturingLinkSource(
  linkSource: SalesOrderDetailType["linkedManufacturingOrders"][number]["linkSource"]
) {
  if (linkSource === "both") return "Sales + allocation";
  if (linkSource === "output_allocation") return "Allocated output";
  return "Sales order";
}

function ActivityPanel({ order }: { order: SalesOrderDetailType }) {
  const timeZone = useOrganizationTimeZone();
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
            {formatDateTime(event.timestamp, timeZone)}
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
  const timeZone = useOrganizationTimeZone();
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
	  const [negativeStockWarning, setNegativeStockWarning] = useState<{
	    shipmentId: string;
	    idempotencyKey: string;
	    warning: NegativeStockWarningPayload;
	  } | null>(null);
  const [shipmentForm, setShipmentForm] = useState<ShipmentFormState | null>(null);
  const [shipmentCostForm, setShipmentCostForm] =
    useState<ShipmentCostFormState | null>(null);
  const [lineToDelete, setLineToDelete] =
    useState<SalesOrderDetailType["lines"][number] | null>(null);
  const [deleteLineIdempotencyKey, setDeleteLineIdempotencyKey] =
    useState<string | null>(null);
  const [draftTakeoverWarning, setDraftTakeoverWarning] =
    useState<DraftAllocationTakeoverWarningPayload | null>(null);
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
    includeEmail = false,
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
          timeZone,
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
    includeEmail = false,
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
          timeZone,
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

  const deleteLineMutation = useMutation({
    mutationFn: async ({ lineId, idempotencyKey }: DeleteLineActionPayload) => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "PUT",
        headers: {
          "Idempotency-Key": idempotencyKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildSalesOrderLineRemovalPayload(order, lineId)),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete line.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-detail", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setLineToDelete(null);
      setDeleteLineIdempotencyKey(null);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}/duplicate`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-order-duplicate"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to duplicate order.");
      }
      return body as { id: string };
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      router.push(`/sales/orders/${created.id}`);
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
	    mutationFn: async ({
	      shipmentId,
	      idempotencyKey,
	      confirmNegativeStock,
	    }: ShipmentActionPayload) => {
	      const response = await fetch(
	        `/api/sales-orders/${order.id}/shipments/${shipmentId}/ship`,
	        {
	          method: "POST",
	          headers: {
	            "Idempotency-Key": idempotencyKey,
	            "Content-Type": "application/json",
	          },
	          body: JSON.stringify({ confirmNegativeStock }),
	        }
	      );
	      const body = await response.json().catch(() => null);
	      if (!response.ok) {
	        throw {
	          status: response.status,
	          error: getApiErrorMessage(body, "Failed to ship shipment."),
	          negativeStock: body?.negativeStock,
	        } satisfies ActionError;
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
          timeZone,
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
	      setNegativeStockWarning(null);
	      router.refresh();
	    },
	    onError: (error: ActionError, variables) => {
	      if (error.status === 409 && error.negativeStock) {
	        setNegativeStockWarning({
	          shipmentId: variables.shipmentId,
	          idempotencyKey: variables.idempotencyKey,
	          warning: error.negativeStock,
	        });
	        setSyncDialog(null);
	        return;
	      }
	      const message = error.error ?? "Failed to ship shipment.";
	      setActionError(message);
	      failSyncDialog({
	        title: "Shipment Failed",
	        description: "The shipment was not marked shipped.",
	        localActionLabel: "Mark shipment shipped",
	        message,
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
    mutationFn: async (flags: {
      confirmDraftAllocationTakeover?: boolean;
    }) => {
      const response = await fetch(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-order-confirm", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(flags),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: getApiErrorMessage(body, "Failed to confirm order."),
          draftAllocationTakeover: body?.draftAllocationTakeover,
        } satisfies ActionError;
      }
    },
    onMutate: () => {
      setActionError(null);
      setDraftTakeoverWarning(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setDraftTakeoverWarning(null);
      router.refresh();
    },
    onError: (error: ActionError) => {
      if (error.status === 409 && error.draftAllocationTakeover) {
        setDraftTakeoverWarning(error.draftAllocationTakeover);
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
        includeEmail: false,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      await finishSyncDialog({
        title: "Invoice Sync Complete",
        description: "The latest Xero invoice result is shown below.",
        localActionLabel: "Start retry",
        includeEmail: false,
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

  const shipmentXeroPushMutation = useMutation({
    mutationFn: async ({
      shipment,
      idempotencyKey,
    }: ShipmentInvoiceActionPayload) => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${shipment.id}/xero-push`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to push shipment invoice to Xero.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
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
  const canEdit = !isDeleted && (order.status === "draft" || order.status === "confirmed");
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
  const canInvoiceOrderStatus =
    order.status === "confirmed" ||
    order.status === "partially_shipped" ||
    order.status === "shipped";
  const canRetryXeroPush =
    canInvoiceOrderStatus &&
    (order.xeroPushStatus === "failed" || order.xeroPushStatus === "pending");
  const canCreateXeroInvoice =
    !isDeleted && canInvoiceOrderStatus && !order.xeroPushStatus;
  const canCreateShipment =
    !isDeleted &&
    (order.status === "confirmed" || order.status === "partially_shipped");
  const hasCancelledRemainingHistory =
    order.status === "cancelled" &&
    order.shipments.some((shipment) => shipment.status === "shipped");
  const tabs: SalesOrderTabConfig[] = [
    { value: "lines", label: "Line Items", count: order.lines.length },
    { value: "shipping", label: "Shipping", count: order.shipments.length },
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

  const openDeleteLineDialog = (line: SalesOrderDetailType["lines"][number]) => {
    setLineToDelete(line);
    setDeleteLineIdempotencyKey(`sales-order-line-delete:${crypto.randomUUID()}`);
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
                ...(!isDeleted
                  ? [
                      {
                        label: "Duplicate",
                        onSelect: () => duplicateMutation.mutate(),
                        disabled: duplicateMutation.isPending,
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
                  onClick={() => confirmMutation.mutate({})}
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
                  Plan shipment
                </Button>
              ) : null}
              {canCreateManufacturingOrders ? (
                <CreateManufacturingOrdersDialog
                  salesOrderId={order.id}
                  initialOrder={order}
                  openManufacturingOrders={order.linkedManufacturingOrders.map(
                    (manufacturingOrder) => ({
                      id: manufacturingOrder.id,
                      orderNumber: manufacturingOrder.orderNumber,
                      itemName: manufacturingOrder.productName,
                      quantity: `${formatQuantity(manufacturingOrder.plannedQuantity)} ${manufacturingOrder.unitName}`,
                      plannedDate: manufacturingOrder.plannedDate,
                      priorityRank: manufacturingOrder.priorityRank,
                      status: manufacturingOrder.status,
                    })
                  )}
                  buttonVariant="outline"
                />
              ) : null}
            </DetailPageActions>
          </div>

          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

          <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
            <KeyFactRows order={order} canEdit={canEdit} />
            <CompactMarginReceipt margin={order.marginSummary} />
            <div className="lg:col-span-2">{accountingStatus}</div>
          </div>

          <SalesOrderDetailTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            panels={{
              lines: (
                <LinesPanel
                  order={order}
                  canEdit={canEdit}
                  onDeleteLine={openDeleteLineDialog}
                  deletingLineId={
                    deleteLineMutation.isPending ? lineToDelete?.id ?? null : null
                  }
                />
              ),
              shipping: (
                <ShippingPanel
                  order={order}
                  canCreateShipment={canCreateShipment}
                  canCreateOrderInvoice={canCreateXeroInvoice}
                  canEdit={canEdit}
                  hasCancelledRemainingHistory={hasCancelledRemainingHistory}
                  onCreateShipment={() =>
                    setShipmentForm(buildShipmentFormState(order))
                  }
                  onCreateOrderInvoice={() => xeroPushMutation.mutate()}
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
                  onCreateShipmentInvoice={(shipment) =>
                    shipmentXeroPushMutation.mutate({
                      shipment,
                      idempotencyKey: `sales-shipment-xero-push:${crypto.randomUUID()}`,
                    })
                  }
                  shipShipmentPending={shipShipmentMutation.isPending}
                  cancelShipmentPending={cancelShipmentMutation.isPending}
                  createOrderInvoicePending={xeroPushMutation.isPending}
                  createShipmentInvoicePending={shipmentXeroPushMutation.isPending}
                />
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
              {shipmentForm?.shipmentId ? "Edit Shipment" : "Ready to Ship"}
            </DialogTitle>
            <DialogDescription>
              The BOL is generated automatically from the ready shipment.
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
          </DialogHeader>
          {shipmentCostForm ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                shipmentCostMutation.mutate(shipmentCostForm);
              }}
            >
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

      <AlertDialog open={draftTakeoverWarning != null} onOpenChange={(open) => {
        if (!open) {
          setDraftTakeoverWarning(null);
        }
      }}>
        <AlertDialogContent size="2xl" className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Take Open Allocations?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirming this order will reduce stock allocated to other open orders.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 overflow-y-auto pr-1 text-sm">
            {draftTakeoverWarning?.allocations.map((allocation) => (
              <div
                key={`${allocation.salesOrderLineId}-${allocation.itemId}`}
                className="flex justify-between gap-4 rounded-md border p-2"
              >
                <span>
                  {allocation.orderNumber} · {allocation.customerName} ·{" "}
                  {allocation.itemName}
                </span>
                <span className="font-medium">
                  {allocation.quantity} {allocation.unitName}
                </span>
              </div>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending}
              onClick={() =>
                confirmMutation.mutate({ confirmDraftAllocationTakeover: true })
              }
            >
              {confirmMutation.isPending ? "Confirming..." : "Take and Confirm"}
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
              Ready shipments will be cancelled and unshipped reservations released.
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
	        open={negativeStockWarning != null}
	        onOpenChange={(open) => {
	          if (!open) setNegativeStockWarning(null);
	        }}
	      >
	        <AlertDialogContent className="bg-background text-foreground">
	          <AlertDialogHeader>
	            <AlertDialogTitle>Ship with negative stock?</AlertDialogTitle>
	            <AlertDialogDescription>
	              {negativeStockWarning
	                ? `${negativeStockWarning.warning.itemName} is short by ${formatQuantity(
	                    String(negativeStockWarning.warning.shortage)
	                  )}. Continuing will record negative inventory.`
	                : "Continuing will record negative inventory."}
	            </AlertDialogDescription>
	          </AlertDialogHeader>
	          <AlertDialogFooter>
	            <AlertDialogCancel>Back</AlertDialogCancel>
	            <AlertDialogAction
	              disabled={shipShipmentMutation.isPending}
	              onClick={() => {
	                if (!negativeStockWarning) return;
	                shipShipmentMutation.mutate({
	                  shipmentId: negativeStockWarning.shipmentId,
	                  idempotencyKey: negativeStockWarning.idempotencyKey,
	                  confirmNegativeStock: true,
	                });
	              }}
	            >
	              {shipShipmentMutation.isPending ? "Shipping..." : "Ship Anyway"}
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

      <AlertDialog
        open={lineToDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteLineMutation.isPending) {
            setLineToDelete(null);
            setDeleteLineIdempotencyKey(null);
          }
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this line?</AlertDialogTitle>
            <AlertDialogDescription>
              {lineToDelete
                ? `${lineToDelete.itemName} will be removed from this order.`
                : "This line will be removed from the order."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLineMutation.isPending}>
              Back
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                deleteLineMutation.isPending ||
                !lineToDelete ||
                !deleteLineIdempotencyKey
              }
              onClick={() => {
                if (lineToDelete && deleteLineIdempotencyKey) {
                  deleteLineMutation.mutate({
                    lineId: lineToDelete.id,
                    idempotencyKey: deleteLineIdempotencyKey,
                  });
                }
              }}
            >
              {deleteLineMutation.isPending ? "Deleting..." : "Delete Line"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
