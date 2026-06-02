"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
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
import {
  formatDate,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import { calculateSalesLineTotalForQuantity } from "@/lib/sales/order-calculations";
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
import { CardPage, CardPageBanner, CardPageBody, CardSection } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { DetailHeaderTitle } from "@/components/card-page/detail-header-title";
import {
  FramedTable,
  FramedTableCell,
  FramedTableHead,
  FramedTableHeaderCell,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import { makeDraftOrder } from "./order-draft";
import { useSalesOrderDraftController } from "./use-sales-order-draft-controller";

export type XeroInvoiceSetupStatus =
  | "not_connected"
  | "missing_sales_account"
  | "provider_conflict"
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
  accountingProviderLabel?: string | null;
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
  accountingProviderLabel,
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
      await apiJson<void>(`/api/sales-orders/${currentOrderId}`, {
        method: "DELETE",
        idempotencyKey: "sales-order-delete",
        fallbackError: "Failed to delete order.",
      });
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
      return apiJson<{ id: string }>(`/api/sales-orders/${currentOrderId}/duplicate`, {
        method: "POST",
        idempotencyKey: "sales-order-duplicate",
        fallbackError: "Failed to duplicate order.",
      });
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
      await apiJson<void>(`/api/sales-orders/${currentOrderId}/accounting-push`, {
        method: "POST",
        idempotencyKey: "retryXeroPushForSalesOrder",
        fallbackError: `Failed to send invoice to ${accountingProviderLabel ?? "accounting"}.`,
      });
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
                    : `Send invoice to ${accountingProviderLabel ?? "accounting"}`,
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

      {actionError ? <CardPageBanner>{actionError}</CardPageBanner> : null}

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
        <FramedTableHead>
          <tr>
            <FramedTableHeaderCell>Item</FramedTableHeaderCell>
            <FramedTableHeaderCell align="right">Quantity left</FramedTableHeaderCell>
            <FramedTableHeaderCell align="right">Price per unit</FramedTableHeaderCell>
            <FramedTableHeaderCell align="right">Tax %</FramedTableHeaderCell>
            <FramedTableHeaderCell align="right">Remaining total</FramedTableHeaderCell>
          </tr>
        </FramedTableHead>
        <tbody>
          {lines.map((line) => (
            <FramedTableRow key={line.id}>
              <FramedTableCell>
                <div className="font-medium">{line.itemName}</div>
                <div className="text-[length:var(--text-sm)] text-muted-foreground">
                  {line.unitName}
                </div>
              </FramedTableCell>
              <FramedTableCell align="right" numeric>
                {formatQuantity(line.remainingQuantity)}{" "}
                <span className="font-sans text-muted-foreground">{line.unitName}</span>
              </FramedTableCell>
              <FramedTableCell align="right" numeric>
                {formatPrice(line.unitPrice) ?? "—"}
              </FramedTableCell>
              <FramedTableCell align="right" numeric>
                {formatPercent(line.taxRatePercent, { fallback: "0%" })}
              </FramedTableCell>
              <FramedTableCell align="right" numeric strong>
                {formatPrice(calculateSalesLineTotalForQuantity(line, line.remainingQuantity)) ?? "—"}
              </FramedTableCell>
            </FramedTableRow>
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
    return sum + Number(calculateSalesLineTotalForQuantity(orderLine, shipmentLine.quantity));
  }, 0);

  return (
    <CardSection
      title="Shipped items"
      count={`· ${shipment.shipmentNumber} · ${formatQuantity(String(totalQuantity))} units`}
    >
      <div className="mb-(--space-3) flex flex-wrap items-center justify-between gap-(--space-4) text-[length:var(--text-sm)] text-muted-foreground">
        <span>Picked date</span>
        <span className="font-mono tabular-nums text-foreground">
          {shipment.shippedAt ? formatDateTime(shipment.shippedAt, timeZone) : "—"}
        </span>
      </div>
      <SalesFulfillmentTable>
        <FramedTableHead>
          <tr>
            <FramedTableHeaderCell>Item</FramedTableHeaderCell>
            <FramedTableHeaderCell align="right">Quantity</FramedTableHeaderCell>
            <FramedTableHeaderCell align="right">Price per unit</FramedTableHeaderCell>
            <FramedTableHeaderCell align="right">Tax %</FramedTableHeaderCell>
            <FramedTableHeaderCell align="right">Total price</FramedTableHeaderCell>
          </tr>
        </FramedTableHead>
        <tbody>
          {shipment.lines.map((shipmentLine) => {
            const orderLine = orderLinesById.get(shipmentLine.salesOrderLineId);
            return (
              <FramedTableRow key={shipmentLine.id}>
                <FramedTableCell>
                  <div className="font-medium">{shipmentLine.itemName}</div>
                  <div className="text-[length:var(--text-sm)] text-muted-foreground">
                    {shipmentLine.unitName}
                  </div>
                </FramedTableCell>
                <FramedTableCell align="right" numeric>
                  {formatQuantity(shipmentLine.quantity)}{" "}
                  <span className="font-sans text-muted-foreground">{shipmentLine.unitName}</span>
                </FramedTableCell>
                <FramedTableCell align="right" numeric>
                  {formatPrice(orderLine?.unitPrice) ?? "—"}
                </FramedTableCell>
                <FramedTableCell align="right" numeric>
                  {formatPercent(orderLine?.taxRatePercent, { fallback: "0%" })}
                </FramedTableCell>
                <FramedTableCell align="right" numeric strong>
                  {formatPrice(calculateSalesLineTotalForQuantity(orderLine, shipmentLine.quantity)) ?? "—"}
                </FramedTableCell>
              </FramedTableRow>
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
    <TableFrame>
      <FramedTable>{children}</FramedTable>
    </TableFrame>
  );
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
      <TableFrame>
        <FramedTable>
          <FramedTableHead>
            <tr>
              <FramedTableHeaderCell>Order</FramedTableHeaderCell>
              <FramedTableHeaderCell>Product</FramedTableHeaderCell>
              <FramedTableHeaderCell align="right">Planned</FramedTableHeaderCell>
              <FramedTableHeaderCell>Status</FramedTableHeaderCell>
              <FramedTableHeaderCell>Deadline</FramedTableHeaderCell>
            </tr>
          </FramedTableHead>
          <tbody>
            {order.linkedManufacturingOrders.map((linkedOrder) => (
              <FramedTableRow key={linkedOrder.id}>
                <FramedTableCell>
                  <Link
                    href={`/manufacturing/order/${linkedOrder.id}`}
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                    prefetch={false}
                  >
                    {linkedOrder.orderNumber}
                  </Link>
                </FramedTableCell>
                <FramedTableCell muted>
                  {linkedOrder.productName}
                </FramedTableCell>
                <FramedTableCell align="right" numeric>
                  {formatQuantity(linkedOrder.plannedQuantity)} {linkedOrder.unitName}
                </FramedTableCell>
                <FramedTableCell>
                  {manufacturingProductionStatusLabel(linkedOrder.productionStatus)}
                </FramedTableCell>
                <FramedTableCell muted>
                  {linkedOrder.plannedDate ? formatDate(linkedOrder.plannedDate) : "—"}
                </FramedTableCell>
              </FramedTableRow>
            ))}
          </tbody>
        </FramedTable>
      </TableFrame>
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
