"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import type {
  CustomerOption,
  SalesAddressOption,
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderItemOption,
  SalesOrderTaxRateOption,
  SalesShipmentRow,
} from "@/app/(dashboard)/sales/types";
import { formatDate, formatDateTime, formatPrice, formatQuantity } from "@/lib/format";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import {
  isSalesOrderStatusDisabled,
  salesOrderStatusConfig,
} from "@/components/card-page/order-status-configs";
import { OrderDetailsGrid } from "./order-details-grid";
import { LineItemsTable } from "./line-items-table";
import { ShippingFeeSection } from "./shipping-fee-section";
import { TotalsStrip } from "./totals-strip";
import {
  CreateManufacturingOrdersDialog,
  defaultManufacturingPlannedDate,
} from "../../create-manufacturing-orders-dialog";
import { CardPage, CardPageBody, CardSection } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { DetailHeaderTitle } from "@/components/card-page/detail-header-title";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import { makeDraftOrder } from "./order-draft";
import { useSalesOrderDraftController } from "./use-sales-order-draft-controller";

export type XeroInvoiceSetupStatus =
  | "not_connected"
  | "missing_sales_account"
  | "ready";

export type OrderCardProps = {
  /** null on the /sales/order draft route. */
  initialOrder: SalesOrderDetail | null;
  initialDraftCustomerId?: string | null;
  initialDraftProjectId?: string | null;
  customerOptions: CustomerOption[];
  itemOptions: SalesOrderItemOption[];
  addressOptions?: SalesAddressOption[];
  canViewLedger?: boolean;
  xeroInvoiceSetupStatus?: XeroInvoiceSetupStatus;
  taxRates?: SalesOrderTaxRateOption[];
  defaultTaxRateId?: string | null;
};

export function OrderCard({
  initialOrder,
  initialDraftCustomerId,
  initialDraftProjectId,
  customerOptions,
  itemOptions,
  addressOptions = [],
  canViewLedger,
  xeroInvoiceSetupStatus,
  taxRates = initialOrder?.taxRates ?? [],
  defaultTaxRateId = initialOrder?.defaultTaxRateId ?? null,
}: OrderCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const timeZone = useOrganizationTimeZone();
  const handleClose = useSmartBack("/sales/orders");

  const initialDraft = useMemo(
    () => makeInitialDraftOrder(timeZone, customerOptions, {
      customerId: initialDraftCustomerId ?? null,
      projectId: initialDraftProjectId ?? null,
      taxRates,
      defaultTaxRateId,
    }),
    [
      customerOptions,
      initialDraftCustomerId,
      initialDraftProjectId,
      taxRates,
      defaultTaxRateId,
      timeZone,
    ],
  );

  const controller = useSalesOrderDraftController({
    initialOrder,
    initialDraft,
    queryClient,
    createMode: initialOrder == null ? "auto-number" : "custom-number",
    onPersisted: (id) => {
      reflectPersistedCardUrlWithoutNavigation(`/sales/order/${id}`);
    },
  });
  const order = controller.draft;
  const currentOrderId = controller.currentOrderId;
  const isDraft = !controller.hasPersistedOrder;

  const [actionError, setActionError] = useState<string | null>(null);
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const shippedShipments = order.shipments.filter(
    (shipment) => shipment.status === "shipped" && shipment.lines.length > 0
  );
  const hasShippedItems = shippedShipments.length > 0;
  const remainingLines = order.lines.filter(
    (line) => Number(line.remainingQuantity) > 0
  );

  const isEditable =
    isDraft ||
    (order.status !== "done" && order.shippingReadiness.state !== "shipped");

  const saveState: CardSaveState =
    controller.status === "saving" || controller.status === "dirty"
      ? "saving"
      : controller.status === "error"
        ? "failed"
        : isDraft
          ? "not_saved"
          : "saved";
  const saveMessage =
    saveState === "failed"
      ? controller.error ?? actionError ?? "Save failed"
      : null;

  // ---- Live mutations ----------------------------------------------------
  const deleteMutation = useDeleteEntity({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "delete"],
    mutationFn: async () => {
      await controller.flush();
      const response = await fetch(`/api/sales-orders/${currentOrderId}`, {
        method: "DELETE",
        headers: createIdempotencyHeaders("sales-order-delete"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to delete order.");
    },
    onMutate: () => setActionError(null),
    invalidateQueryKeys: [["sales-orders"]],
    onDeleted: () => router.push("/sales/orders"),
    onError: (error) => setActionError((error as Error).message),
  });
  const deleteConfirm = useConfirmMutation<void>({
    title: "Delete sales order?",
    description: <>Order {order.orderNumber} will be removed. This cannot be undone.</>,
    confirmLabel: "Delete",
    pendingLabel: "Deleting...",
    mutation: deleteMutation,
  });

  const duplicateMutation = useMutation({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "duplicate"],
    mutationFn: async () => {
      await controller.flush();
      const response = await fetch(`/api/sales-orders/${currentOrderId}/duplicate`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-order-duplicate"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to duplicate order.");
      return body as { id: string };
    },
    onMutate: () => setActionError(null),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      router.push(`/sales/order/${created.id}`);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const orderXeroPushMutation = useMutation({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "order-xero-push"],
    mutationFn: async () => {
      await controller.flush();
      const response = await fetch(`/api/sales-orders/${currentOrderId}/accounting-push`, {
        method: "POST",
        headers: createIdempotencyHeaders("retryXeroPushForSalesOrder"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to send invoice to Xero.");
      }
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await controller.refreshFromServer();
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const handleCloseAfterFlush = useCallback(() => {
    void controller.flush().then(handleClose).catch((error) => {
      setActionError(error instanceof Error ? error.message : "Failed to save order.");
    });
  }, [controller, handleClose]);

  return (
    <CardPage>
      <CardPageHeader
        title={
          isDraft ? (
            "New sales order"
          ) : (
            <DetailHeaderTitle
              recordNumber={order.orderNumber}
              name={order.customerName}
            />
          )
        }
        saveState={saveState}
        saveMessage={saveMessage}
        statusControl={
          !isDraft ? (
            <OrderStatusControl
              config={salesOrderStatusConfig}
              ctx={{ order }}
              disabled={isSalesOrderStatusDisabled(order)}
              onChanged={() => {
                void controller.refreshFromServer();
                void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
              }}
            />
          ) : undefined
        }
        primaryAction={undefined}
        showPrint={false}
        menuActions={[
          ...(!isDraft ? [{ label: "Duplicate", onClick: () => duplicateMutation.mutate() }] : []),
          ...(!isDraft ? [{ label: "Print", onClick: () => window.print() }] : []),
          ...(!isDraft && xeroInvoiceSetupStatus === "ready"
            ? [
                {
                  label: orderXeroPushMutation.isPending
                    ? "Sending invoice..."
                    : "Send invoice to Xero",
                  onClick: () => orderXeroPushMutation.mutate(),
                  disabled: orderXeroPushMutation.isPending,
                },
              ]
            : []),
          ...(!isDraft && canViewLedger
            ? [
                {
                  label: "View inventory activity",
                  href: buildInventoryLedgerHref({
                    documentType: "sales_order",
                    documentId: order.id,
                  }),
                },
              ]
            : []),
          ...(!isDraft && order.hasManufacturableLines
            ? [
                {
                  label: "Create manufacturing order(s)",
                  onClick: () => {
                    void controller
                      .flush()
                      .then(() => setMakeToOrderOpen(true))
                      .catch((error) => {
                        setActionError(error instanceof Error ? error.message : "Failed to save order.");
                      });
                  },
                  disabled: !order.hasManufacturableLines,
                  tooltip: order.manufacturableDisabledReason ?? undefined,
                },
              ]
            : []),
          ...(!isDraft
            ? [
                {
                  label: "Delete order",
                  onClick: () => deleteConfirm.trigger(undefined),
                  destructive: true,
                },
              ]
            : []),
        ]}
        onClose={handleCloseAfterFlush}
        fallbackHref="/sales/orders"
      />

      {actionError ? (
        <div className="px-(--space-5) py-(--space-3) bg-[var(--color-danger-soft)] text-destructive text-sm border-b border-[var(--color-line)]">
          {actionError}
        </div>
      ) : null}

      <CardPageBody>
        <OrderDetailsGrid
          order={order}
          editable={isEditable}
          customerOptions={customerOptions}
          addressOptions={addressOptions}
          controller={controller}
        />

        {hasShippedItems ? (
          <>
            {remainingLines.length > 0 ? (
              <RemainingItemsSection lines={remainingLines} />
            ) : null}
            {shippedShipments.map((shipment) => (
              <ShippedItemsSection
                key={shipment.id}
                order={order}
                shipment={shipment}
                timeZone={timeZone}
              />
            ))}
          </>
        ) : (
          <LineItemsTable
            order={order}
            editable={isEditable}
            itemOptions={itemOptions}
            controller={controller}
          />
        )}

        <LinkedManufacturingOrdersSection order={order} />

        <ShippingFeeSection
          order={order}
          editable={isEditable}
          controller={controller}
        />

        <TotalsStrip
          order={order}
          itemOptions={itemOptions}
          notesEditable={isEditable}
          controller={controller}
        />
      </CardPageBody>

      {isDraft ? null : (
        <>
          <CreateManufacturingOrdersDialog
            salesOrderId={order.id}
            open={makeToOrderOpen}
            onOpenChange={setMakeToOrderOpen}
            showTrigger={false}
            salesOrderLabel={`${order.orderNumber} - ${order.customerName}`}
            initialPlannedDate={defaultManufacturingPlannedDate(order.shipDate)}
            openManufacturingOrders={order.linkedManufacturingOrders
              .filter((linkedOrder) => linkedOrder.status === "open")
              .map((linkedOrder) => ({
                id: linkedOrder.id,
                orderNumber: linkedOrder.orderNumber,
                itemName: linkedOrder.productName,
                quantity: `${linkedOrder.plannedQuantity} ${linkedOrder.unitName}`,
                plannedDate: linkedOrder.plannedDate,
                priorityRank: linkedOrder.priorityRank,
                status: linkedOrder.status,
              }))}
          />
        </>
      )}

      {deleteConfirm.dialog}
    </CardPage>
  );
}

function RemainingItemsSection({ lines }: { lines: SalesOrderDetailLine[] }) {
  const totalQuantity = lines.reduce(
    (sum, line) => sum + Number(line.remainingQuantity || 0),
    0
  );

  return (
    <CardSection
      title="Items not shipped"
      count={`· ${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${formatQuantity(String(totalQuantity))} units`}
    >
      <SalesFulfillmentTable>
        <thead className="bg-[var(--color-surface-muted)] text-[11px] uppercase tracking-normal text-muted-foreground">
          <tr>
            <th className="px-(--space-3) py-(--space-2) text-left font-medium">Item</th>
            <th className="px-(--space-3) py-(--space-2) text-right font-medium">Quantity left</th>
            <th className="px-(--space-3) py-(--space-2) text-right font-medium">Price per unit</th>
            <th className="px-(--space-3) py-(--space-2) text-right font-medium">Tax %</th>
            <th className="px-(--space-3) py-(--space-2) text-right font-medium">Remaining total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t border-[var(--color-line)]">
              <td className="px-(--space-3) py-(--space-2)">
                <div className="font-medium">{line.itemName}</div>
                <div className="text-[length:var(--text-xs)] text-muted-foreground">
                  {line.unitName}
                </div>
              </td>
              <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums">
                {formatQuantity(line.remainingQuantity)}{" "}
                <span className="font-sans text-muted-foreground">{line.unitName}</span>
              </td>
              <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums">
                {formatPrice(line.unitPrice) ?? "—"}
              </td>
              <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums">
                {formatPercent(line.taxRatePercent)}
              </td>
              <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums font-semibold">
                {formatPrice(lineTotalForQuantity(line, line.remainingQuantity)) ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </SalesFulfillmentTable>
    </CardSection>
  );
}

function ShippedItemsSection({
  order,
  shipment,
  timeZone,
}: {
  order: SalesOrderDetail;
  shipment: SalesShipmentRow;
  timeZone: string;
}) {
  const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
  const totalQuantity = shipment.lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0),
    0
  );
  const totalAmount = shipment.lines.reduce((sum, shipmentLine) => {
    const orderLine = orderLinesById.get(shipmentLine.salesOrderLineId);
    return sum + Number(lineTotalForQuantity(orderLine, shipmentLine.quantity));
  }, 0);

  return (
    <CardSection
      title="Shipped items"
      count={`· ${shipment.shipmentNumber} · ${formatQuantity(String(totalQuantity))} units`}
    >
      <div className="mb-(--space-3) flex flex-wrap items-center justify-between gap-(--space-4) text-[length:var(--text-xs)] text-muted-foreground">
        <span>Picked date</span>
        <span className="font-mono tabular-nums text-foreground">
          {shipment.shippedAt ? formatDateTime(shipment.shippedAt, timeZone) : "—"}
        </span>
      </div>
      <SalesFulfillmentTable>
        <thead className="bg-[var(--color-surface-muted)] text-[11px] uppercase tracking-normal text-muted-foreground">
          <tr>
            <th className="px-(--space-3) py-(--space-2) text-left font-medium">Item</th>
            <th className="px-(--space-3) py-(--space-2) text-right font-medium">Quantity</th>
            <th className="px-(--space-3) py-(--space-2) text-right font-medium">Price per unit</th>
            <th className="px-(--space-3) py-(--space-2) text-right font-medium">Tax %</th>
            <th className="px-(--space-3) py-(--space-2) text-right font-medium">Total price</th>
          </tr>
        </thead>
        <tbody>
          {shipment.lines.map((shipmentLine) => {
            const orderLine = orderLinesById.get(shipmentLine.salesOrderLineId);
            return (
              <tr key={shipmentLine.id} className="border-t border-[var(--color-line)]">
                <td className="px-(--space-3) py-(--space-2)">
                  <div className="font-medium">{shipmentLine.itemName}</div>
                  <div className="text-[length:var(--text-xs)] text-muted-foreground">
                    {shipmentLine.unitName}
                  </div>
                </td>
                <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums">
                  {formatQuantity(shipmentLine.quantity)}{" "}
                  <span className="font-sans text-muted-foreground">{shipmentLine.unitName}</span>
                </td>
                <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums">
                  {formatPrice(orderLine?.unitPrice) ?? "—"}
                </td>
                <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums">
                  {formatPercent(orderLine?.taxRatePercent)}
                </td>
                <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums font-semibold">
                  {formatPrice(lineTotalForQuantity(orderLine, shipmentLine.quantity)) ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </SalesFulfillmentTable>
      <div className="flex justify-end px-(--space-3) pt-(--space-2) text-[length:var(--text-sm)]">
        <span className="font-mono tabular-nums font-semibold">
          Total shipped: {formatPrice(String(totalAmount)) ?? "—"}
        </span>
      </div>
    </CardSection>
  );
}

function SalesFulfillmentTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto border border-[var(--color-line)]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function lineTotalForQuantity(
  line: SalesOrderDetailLine | undefined,
  quantity: string
) {
  if (!line) return "0";
  const subtotal = Number(quantity || 0) * Number(line.unitPrice || 0);
  const tax = subtotal * (Number(line.taxRatePercent || 0) / 100);
  return (subtotal + tax).toFixed(2);
}

function formatPercent(value: string | null | undefined) {
  const parsed = value == null ? NaN : Number(value);
  if (!Number.isFinite(parsed)) return "0%";
  return `${parsed.toFixed(1)}%`;
}

function LinkedManufacturingOrdersSection({ order }: { order: SalesOrderDetail }) {
  if (order.linkedManufacturingOrders.length === 0) return null;

  return (
    <CardSection
      title="Manufacturing"
      count={`· ${order.linkedManufacturingOrders.length} order${
        order.linkedManufacturingOrders.length === 1 ? "" : "s"
      }`}
    >
      <div className="overflow-x-auto border border-[var(--color-line)]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[var(--color-surface-muted)] text-[11px] uppercase tracking-normal text-muted-foreground">
            <tr>
              <th className="px-(--space-3) py-(--space-2) text-left font-medium">Order</th>
              <th className="px-(--space-3) py-(--space-2) text-left font-medium">Product</th>
              <th className="px-(--space-3) py-(--space-2) text-right font-medium">Planned</th>
              <th className="px-(--space-3) py-(--space-2) text-left font-medium">Status</th>
              <th className="px-(--space-3) py-(--space-2) text-left font-medium">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {order.linkedManufacturingOrders.map((linkedOrder) => (
              <tr key={linkedOrder.id} className="border-t border-[var(--color-line)]">
                <td className="px-(--space-3) py-(--space-2)">
                  <Link
                    href={`/manufacturing/order/${linkedOrder.id}`}
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                    prefetch={false}
                  >
                    {linkedOrder.orderNumber}
                  </Link>
                </td>
                <td className="px-(--space-3) py-(--space-2) text-muted-foreground">
                  {linkedOrder.productName}
                </td>
                <td className="px-(--space-3) py-(--space-2) text-right font-mono tabular-nums">
                  {formatQuantity(linkedOrder.plannedQuantity)} {linkedOrder.unitName}
                </td>
                <td className="px-(--space-3) py-(--space-2)">
                  {manufacturingProductionStatusLabel(linkedOrder.productionStatus)}
                </td>
                <td className="px-(--space-3) py-(--space-2) text-muted-foreground">
                  {linkedOrder.plannedDate ? formatDate(linkedOrder.plannedDate) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardSection>
  );
}

function manufacturingProductionStatusLabel(
  status: SalesOrderDetail["linkedManufacturingOrders"][number]["productionStatus"],
) {
  switch (status) {
    case "blocked":
      return "Blocked";
    case "in_progress":
      return "Work in progress";
    case "done":
      return "Done";
    case "not_started":
    default:
      return "Not started";
  }
}

function makeInitialDraftOrder(
  timeZone: string,
  customerOptions: CustomerOption[],
  defaults: {
    customerId: string | null;
    projectId: string | null;
    taxRates: SalesOrderTaxRateOption[];
    defaultTaxRateId: string | null;
  },
) {
  const draft = {
    ...makeDraftOrder(timeZone),
    taxRates: defaults.taxRates,
    defaultTaxRateId: defaults.defaultTaxRateId,
  };
  if (!defaults.customerId) {
    return draft;
  }

  const customer = customerOptions.find((option) => option.id === defaults.customerId);
  if (!customer) {
    return draft;
  }

  const project = defaults.projectId
    ? customer.projects.find((option) => option.id === defaults.projectId)
    : null;

  return {
    ...draft,
    customerId: customer.id,
    customerName: customer.name,
    customerProjectId: project?.id ?? null,
    customerProjectName: project?.name ?? null,
    shipLine1: customer.shipLine1,
    shipLine2: customer.shipLine2,
    shipCity: customer.shipCity,
    shipRegion: customer.shipRegion,
    shipPostcode: customer.shipPostcode,
    shipCountry: customer.shipCountry,
  };
}
