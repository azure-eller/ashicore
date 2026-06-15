"use client";

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
} from "@/lib/sales/types";
import {
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
import {
  flushClosableCardOrThrow,
  flushSavedCardOrThrow,
  useCardEntityActions,
} from "@/components/card-page/use-card-entity-actions";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import { makeDraftOrder } from "./order-draft";
import { useSalesOrderDraftController } from "./use-sales-order-draft-controller";
import { queryKeys } from "@/lib/client/query-keys";

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
    timeZone,
    taxRates,
    defaultTaxRateId,
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
  const shippedLines = order.lines.filter((line) => Number(line.shippedQuantity) > 0);
  const hasShippedItems = shippedLines.length > 0;
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
  const actions = useCardEntityActions({
    entity: "sales-order-action",
    getId: () => controller.currentOrderId,
    flush: controller.flush,
    invalidateQueryKeys: [queryKeys.salesOrders.root],
    onMutate: () => setActionError(null),
    onError: (error) => setActionError(error.message),
    duplicate: {
      run: (id) =>
        apiJson<{ id: string }>(`/api/sales-orders/${id}/duplicate`, {
          method: "POST",
          idempotencyKey: "sales-order-duplicate",
          fallbackError: "Failed to duplicate order.",
        }),
      navigateTo: (id) => `/sales/order/${id}`,
    },
    delete: {
      label: "Delete order",
      run: (id) =>
        apiJson<void>(`/api/sales-orders/${id}`, {
          method: "DELETE",
          idempotencyKey: "sales-order-delete",
          fallbackError: "Failed to delete order.",
        }),
      navigateTo: "/sales/orders",
      confirm: {
        title: "Delete sales order?",
        description: <>Order {order.orderNumber} will be removed. This cannot be undone.</>,
      },
    },
  });

  const orderXeroPushMutation = useMutation({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "order-xero-push"],
    mutationFn: async () => {
      await flushSavedCardOrThrow({
        flush: controller.flush,
        blockedMessage: "Fix the highlighted fields.",
      });
      const orderId = controller.currentOrderId;
      if (!orderId) throw new Error("Save the order first.");
      await apiJson<void>(`/api/sales-orders/${orderId}/accounting-push`, {
        method: "POST",
        idempotencyKey: "retryXeroPushForSalesOrder",
        fallbackError: `Failed to send invoice to ${accountingProviderLabel ?? "accounting"}.`,
      });
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await controller.refreshFromServer();
      await queryClient.invalidateQueries({ queryKey: queryKeys.salesOrders.root });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const handleCloseAfterFlush = useCallback(() => {
    void flushClosableCardOrThrow({ flush: controller.flush })
      .then(() => {
        handleClose();
      })
      .catch((error) => setActionError((error as Error).message));
  }, [controller, handleClose]);
  const flushBeforeStatusTransition = useCallback(async () => {
    await flushSavedCardOrThrow({
      flush: controller.flush,
      blockedMessage: "Save changes before changing status.",
      fallbackError: "Save changes before changing status.",
    });
  }, [controller]);

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
              actionBoundary={{
                flushPolicy: "requireSaved",
                requiresPersistedId: true,
                beforeTransition: flushBeforeStatusTransition,
              }}
              onTransitionError={(error) => setActionError(error.message)}
              onChanged={() => {
                void controller.refreshFromServer();
                void queryClient.invalidateQueries({ queryKey: queryKeys.salesOrders.root });
              }}
            />
          ) : undefined
        }
        primaryAction={undefined}
        showPrint={false}
        menuActions={[
          ...(!isDraft && actions.duplicateAction ? [actions.duplicateAction] : []),
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
                    void flushSavedCardOrThrow({
                      flush: controller.flush,
                      blockedMessage: "Fix the highlighted fields.",
                    })
                      .catch(() => undefined)
                      .finally(() => setMakeToOrderOpen(true));
                  },
                },
              ]
            : []),
          ...(!isDraft && actions.deleteAction ? [actions.deleteAction] : []),
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
            <ShippedItemsSection lines={shippedLines} />
          </>
        ) : (
          <LineItemsTable
            order={order}
            editable={isEditable}
            itemOptions={itemOptions}
            controller={controller}
          />
        )}

        <ShippingFeeSection
          order={order}
          editable={isEditable && !hasShippedItems}
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

      {actions.dialogs}
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
                <div className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                  {line.unitName}
                </div>
              </FramedTableCell>
              <FramedTableCell align="right" numeric>
                {formatQuantity(line.remainingQuantity)}{" "}
                <span className="font-[var(--font-body)] text-[var(--color-ink-faint)]">{line.unitName}</span>
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
  lines,
}: {
  lines: SalesOrderDetailLine[];
}) {
  const totalQuantity = lines.reduce(
    (sum, line) => sum + Number(line.shippedQuantity || 0),
    0
  );
  const totalAmount = lines.reduce((sum, line) => {
    return sum + Number(calculateSalesLineTotalForQuantity(line, line.shippedQuantity));
  }, 0);

  return (
    <CardSection
      title="Shipped items"
      count={`· ${formatQuantity(String(totalQuantity))} units`}
    >
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
          {lines.map((line) => {
            return (
              <FramedTableRow key={line.id}>
                <FramedTableCell>
                  <div className="font-medium">{line.itemName}</div>
                  <div className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                    {line.unitName}
                  </div>
                </FramedTableCell>
                <FramedTableCell align="right" numeric>
                  {formatQuantity(line.shippedQuantity)}{" "}
                  <span className="font-[var(--font-body)] text-[var(--color-ink-faint)]">{line.unitName}</span>
                </FramedTableCell>
                <FramedTableCell align="right" numeric>
                  {formatPrice(line.unitPrice) ?? "—"}
                </FramedTableCell>
                <FramedTableCell align="right" numeric>
                  {formatPercent(line.taxRatePercent, { fallback: "0%" })}
                </FramedTableCell>
                <FramedTableCell align="right" numeric strong>
                  {formatPrice(calculateSalesLineTotalForQuantity(line, line.shippedQuantity)) ?? "—"}
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
