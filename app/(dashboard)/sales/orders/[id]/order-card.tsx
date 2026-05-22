"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import {
  createSalesOrder,
  fetchSalesOrderDetail,
  patchSalesOrderHeader,
  updateSalesOrderFull,
} from "@/lib/api/clients/sales-orders";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import { formatDate, formatPrice, toDateOnlyString } from "@/lib/format";
import type {
  CustomerOption,
  SalesAddressOption,
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderItemOption,
  SalesShipmentRow,
} from "@/app/(dashboard)/sales/types";
import { SalesStatusControl } from "@/components/sales/sales-status-control";
import { OrderDetailsGrid } from "./order-details-grid";
import { LineItemsTable } from "./line-items-table";
import { ShipmentsTable } from "./shipments-table";
import { TotalsStrip } from "./totals-strip";
import { PlanShipmentDialog } from "./plan-shipment-dialog";
import { MarkShippedDialog } from "./mark-shipped-dialog";
import { ShipmentCostsDialog } from "./shipment-costs-dialog";
import { CreateManufacturingOrdersDialog } from "../../create-manufacturing-orders-dialog";
import { CardPage, CardPageBody } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { DetailHeaderTitle } from "@/components/card-page/detail-header-title";
import { CardMetaStrip, CardMetaValue } from "@/components/card-page/card-meta-strip";
import {
  cardSaveMutationKey,
  saveStateFromEntityStatus,
  useEntitySaveStatus,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import {
  draftToInsertPayload,
  makeDraftLine,
  makeDraftOrder,
  orderToUpdatePayload,
  type OrderDraftController,
} from "./order-draft";

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
}: OrderCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const timeZone = useOrganizationTimeZone();
  const handleClose = useSmartBack("/sales/orders");

  const [currentOrderId, setCurrentOrderId] = useState<string | null>(
    initialOrder?.id ?? null,
  );
  const [draftOrder, setDraftOrder] = useState<SalesOrderDetail>(
    () => initialOrder ?? makeInitialDraftOrder(timeZone, customerOptions, {
      customerId: initialDraftCustomerId ?? null,
      projectId: initialDraftProjectId ?? null,
    }),
  );
  const startsAsNewOrder = initialOrder == null;
  const autoCreateStartedRef = useRef(false);
  const latestDraftOrderRef = useRef(draftOrder);
  const hasPersistedOrder = currentOrderId != null;
  const isDraft = !hasPersistedOrder;

  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shipmentDialogTarget, setShipmentDialogTarget] = useState<
    "new" | SalesShipmentRow | null
  >(null);
  const [shipTarget, setShipTarget] = useState<SalesShipmentRow | null>(null);
  const [costsTarget, setCostsTarget] = useState<SalesShipmentRow | null>(null);
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const [deleteShipmentTarget, setDeleteShipmentTarget] =
    useState<SalesShipmentRow | null>(null);

  const orderQuery = useQuery({
    queryKey: ["sales-order", currentOrderId ?? "__draft__"],
    queryFn: () => fetchSalesOrderDetail(currentOrderId as string),
    initialData: initialOrder ?? undefined,
    enabled: hasPersistedOrder,
    refetchOnWindowFocus: false,
  });
  const order = isDraft ? draftOrder : orderQuery.data ?? draftOrder;
  const liveSaveStatus = useEntitySaveStatus(
    "sales-order",
    currentOrderId ?? "__draft__",
  );

  const isEditable =
    isDraft ||
    (order.status !== "done" && order.shippingReadiness.state !== "shipped");

  useEffect(() => {
    latestDraftOrderRef.current = draftOrder;
  }, [draftOrder]);

  // ---- Draft controller (local writes before the order exists) ----------
  const recomputeTotals = useCallback((next: SalesOrderDetail): SalesOrderDetail => {
    const revenue = next.lines.reduce(
      (sum, line) => sum + Number(line.lineTotal || 0),
      0,
    );
    return {
      ...next,
      totalAmount: revenue.toFixed(2),
      marginSummary: {
        ...next.marginSummary,
        productRevenue: revenue.toFixed(2),
      },
    };
  }, []);

  const draftHeaderMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "sales-order",
      currentOrderId ?? "__draft__",
      "header",
      "new-card",
    ),
    mutationFn: (patch: Parameters<typeof patchSalesOrderHeader>[1]) =>
      patchSalesOrderHeader(currentOrderId as string, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", next.id], next);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const persistDraftHeaderPatch = useCallback(
    (patch: Parameters<typeof patchSalesOrderHeader>[1]) => {
      if (!currentOrderId) return;
      draftHeaderMutation.mutate(patch);
    },
    [currentOrderId, draftHeaderMutation],
  );

  const draftController = useMemo<OrderDraftController>(
    () => ({
      patchHeader: (patch) => {
        setDraftOrder((prev) => ({ ...prev, ...patch }) as SalesOrderDetail);
        persistDraftHeaderPatch(persistedDraftHeaderPatch(patch));
      },
      addLine: (line) =>
        setDraftOrder((prev) => recomputeTotals({ ...prev, lines: [...prev.lines, line] })),
      updateLine: (lineId, patch) =>
        setDraftOrder((prev) =>
          recomputeTotals({
            ...prev,
            lines: prev.lines.map((line) => {
              if (line.id !== lineId) return line;
              const quantity = patch.quantity ?? line.quantity;
              const unitPrice = patch.unitPrice ?? line.unitPrice;
              const lineTotal = (Number(quantity) * Number(unitPrice)).toFixed(2);
              return { ...line, quantity, unitPrice, lineTotal };
            }),
          }),
        ),
      removeLine: (lineId) =>
        setDraftOrder((prev) =>
          recomputeTotals({
            ...prev,
            lines: prev.lines.filter((line) => line.id !== lineId),
          }),
        ),
      reorderLines: (orderedIds) =>
        setDraftOrder((prev) => ({
          ...prev,
          lines: orderedIds
            .map((id) => prev.lines.find((line) => line.id === id))
            .filter((line): line is SalesOrderDetailLine => line != null),
        })),
    }),
    [persistDraftHeaderPatch, recomputeTotals],
  );

  const createMutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", "__draft__", "create"),
    mutationFn: async () => {
      const created = await createSalesOrder(draftToInsertPayload(draftOrder));
      return created;
    },
    onMutate: () => setActionError(null),
    onSuccess: (created) => {
      const latestDraft = latestDraftOrderRef.current;
      setCurrentOrderId(created.id);
      setDraftOrder((current) => {
        const next = ({ ...current, id: created.id }) as SalesOrderDetail;
        latestDraftOrderRef.current = next;
        return next;
      });
      queryClient.setQueryData(["sales-order", created.id], {
        ...latestDraft,
        id: created.id,
      });
      void patchSalesOrderHeader(created.id, persistedOrderHeaderPatch(latestDraft))
        .then((next) => {
          queryClient.setQueryData(["sales-order", created.id], next);
        })
        .catch((error) => setActionError((error as Error).message));
      void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      window.history.replaceState(null, "", `/sales/orders/${created.id}`);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const canCreate = draftOrder.customerId.trim().length > 0;
  const saveState: CardSaveState = isDraft
    ? createMutation.isPending || draftHeaderMutation.isPending
      ? "saving"
      : createMutation.isError || draftHeaderMutation.isError
        ? "failed"
        : "not_saved"
    : saveStateFromEntityStatus(liveSaveStatus.status);

  useEffect(() => {
    if (!startsAsNewOrder || hasPersistedOrder || !canCreate) return;
    if (autoCreateStartedRef.current || createMutation.isPending) return;
    autoCreateStartedRef.current = true;
    createMutation.mutate();
  }, [canCreate, createMutation, hasPersistedOrder, startsAsNewOrder]);

  // ---- Live mutations ----------------------------------------------------
  const deleteMutation = useMutation({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "delete"],
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${currentOrderId}`, {
        method: "DELETE",
        headers: createIdempotencyHeaders("sales-order-delete"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to delete order.");
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      router.push("/sales/orders");
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const duplicateMutation = useMutation({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "duplicate"],
    mutationFn: async () => {
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
      router.push(`/sales/orders/${created.id}`);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const deleteLineMutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", currentOrderId ?? "draft", "delete-line"),
    mutationFn: (line: SalesOrderDetailLine) =>
      updateSalesOrderFull(
        currentOrderId as string,
        orderToUpdatePayload(order, (lines) =>
          lines.filter((existing) => existing.id !== line.id),
        ),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["sales-order", currentOrderId],
      });
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const addLineMutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", currentOrderId ?? "draft", "add-line"),
    mutationFn: (option: SalesOrderItemOption) =>
      updateSalesOrderFull(
        currentOrderId as string,
        orderToUpdatePayload(order, (lines) => [
          ...lines,
          makeDraftLine({
            itemId: option.id,
            itemName: option.displayName || option.name,
            itemSku: option.sku,
            unitName: option.unitName,
            quantity: "1",
            unitPrice: option.defaultSellingPrice ?? "0",
            estimatedUnitCost: option.estimatedUnitCost,
          }),
        ]),
      ),
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["sales-order", currentOrderId],
      });
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const handleDeleteLine = useCallback(
    async (line: SalesOrderDetailLine) => {
      if (isDraft) {
        draftController.removeLine(line.id);
        return;
      }
      await deleteLineMutation.mutateAsync(line);
    },
    [isDraft, draftController, deleteLineMutation],
  );

  const handleAddLineItem = useCallback(
    (option: SalesOrderItemOption) => {
      addLineMutation.mutate(option);
    },
    [addLineMutation],
  );

  const reorderLinesMutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", currentOrderId ?? "draft", "reorder-lines"),
    mutationFn: (orderedIds: string[]) =>
      updateSalesOrderFull(
        currentOrderId as string,
        orderToUpdatePayload(order, (lines) =>
          orderedIds
            .map((id) => lines.find((line) => line.id === id))
            .filter((line): line is SalesOrderDetailLine => line != null),
        ),
      ),
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-order", currentOrderId] });
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const handleReorderLines = useCallback(
    (orderedIds: string[]) => {
      if (isDraft) {
        draftController.reorderLines(orderedIds);
        return;
      }
      reorderLinesMutation.mutate(orderedIds);
    },
    [isDraft, draftController, reorderLinesMutation],
  );

  const deleteShipmentMutation = useMutation({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "delete-shipment"],
    mutationFn: async (shipment: SalesShipmentRow) => {
      const response = await fetch(
        `/api/sales-orders/${currentOrderId}/shipments/${shipment.id}`,
        {
          method: "DELETE",
          headers: createIdempotencyHeaders("deleteSalesShipment"),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to delete shipment.");
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-order", currentOrderId] });
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      setDeleteShipmentTarget(null);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const shipmentXeroPushMutation = useMutation({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "shipment-xero-push"],
    mutationFn: async (shipment: SalesShipmentRow) => {
      const response = await fetch(
        `/api/sales-orders/${currentOrderId}/shipments/${shipment.id}/xero-push`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("retryXeroPushForSalesShipment"),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to push to Xero.");
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-order", currentOrderId] });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const orderXeroPushMutation = useMutation({
    mutationKey: ["sales-order-action", currentOrderId ?? "draft", "order-xero-push"],
    mutationFn: async () => {
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
      await queryClient.invalidateQueries({ queryKey: ["sales-order", currentOrderId] });
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  return (
    <CardPage>
      <CardPageHeader
        eyebrow="Sales order"
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
        meta={<SalesOrderMeta order={order} />}
        saveState={saveState}
        statusControl={
          !isDraft ? (
            <SalesStatusControl
              order={order}
              onChanged={() => {
                void queryClient.invalidateQueries({ queryKey: ["sales-order", order.id] });
                void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
              }}
            />
          ) : undefined
        }
        primaryAction={undefined}
        menuActions={[
          ...(!isDraft ? [{ label: "Duplicate", onClick: () => duplicateMutation.mutate() }] : []),
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
                  onClick: () => setMakeToOrderOpen(true),
                  disabled: !order.hasManufacturableLines,
                  tooltip: order.manufacturableDisabledReason ?? undefined,
                },
              ]
            : []),
          ...(!isDraft
            ? [
                {
                  label: "Delete order",
                  onClick: () => setConfirmDelete(true),
                  destructive: true,
                },
              ]
            : []),
        ]}
        onClose={handleClose}
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
          draft={isDraft ? draftController : undefined}
        />

        <LineItemsTable
          order={order}
          editable={isEditable}
          itemOptions={itemOptions}
          draft={isDraft ? draftController : undefined}
          onAddLineItem={handleAddLineItem}
          addingLine={addLineMutation.isPending}
          onDeleteLine={isEditable ? handleDeleteLine : undefined}
          onReorderLines={isEditable ? handleReorderLines : undefined}
          onPatchLine={
            isDraft
              ? (lineId, patch) => draftController.updateLine(lineId, patch)
              : undefined
          }
        />

        <ShipmentsTable
          order={order}
          editable={isEditable}
          addDisabledReason={
            isDraft
              ? "Choose a customer first."
              : order.shipments.length > 0
                ? "Create a separate sales order for another shipment."
                : null
          }
          onNewShipment={
            isEditable
              ? () => {
                  if (isDraft) return;
                  setShipmentDialogTarget("new");
                }
              : undefined
          }
          onEditShipment={
            isEditable && !isDraft ? (shipment) => setShipmentDialogTarget(shipment) : undefined
          }
          onMarkShipped={isEditable && !isDraft ? (shipment) => setShipTarget(shipment) : undefined}
          onEditCosts={!isDraft ? (shipment) => setCostsTarget(shipment) : undefined}
          onPushXero={!isDraft ? (shipment) => shipmentXeroPushMutation.mutate(shipment) : undefined}
          onDeleteShipment={
            isEditable && !isDraft ? (shipment) => setDeleteShipmentTarget(shipment) : undefined
          }
        />

        <TotalsStrip
          order={order}
          notesEditable={isEditable}
          draft={isDraft ? draftController : undefined}
        />
      </CardPageBody>

      {isDraft ? null : (
        <>
          <PlanShipmentDialog
            order={order}
            target={shipmentDialogTarget}
            onClose={() => setShipmentDialogTarget(null)}
          />
          <MarkShippedDialog
            order={order}
            shipment={shipTarget}
            xeroReady={xeroInvoiceSetupStatus === "ready"}
            onClose={() => setShipTarget(null)}
          />
          <ShipmentCostsDialog
            order={order}
            shipment={costsTarget}
            onClose={() => setCostsTarget(null)}
          />
          <CreateManufacturingOrdersDialog
            salesOrderId={order.id}
            open={makeToOrderOpen}
            onOpenChange={setMakeToOrderOpen}
            showTrigger={false}
            salesOrderLabel={`${order.orderNumber} - ${order.customerName}`}
            initialPlannedDate={order.shipDate ?? order.requestedDate ?? undefined}
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
          <AlertDialog
            open={deleteShipmentTarget != null}
            onOpenChange={(next) => {
              if (!next) setDeleteShipmentTarget(null);
            }}
          >
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete shipment?</AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteShipmentTarget
                    ? `${deleteShipmentTarget.shipmentNumber} will be removed and its planned allocations released. This cannot be undone.`
                    : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    if (deleteShipmentTarget) {
                      deleteShipmentMutation.mutate(deleteShipmentTarget);
                    }
                  }}
                  disabled={deleteShipmentMutation.isPending}
                >
                  {deleteShipmentMutation.isPending ? "Deleting…" : "Delete shipment"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sales order?</AlertDialogTitle>
            <AlertDialogDescription>
              Order {order.orderNumber} will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => deleteMutation.reset()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardPage>
  );
}

function SalesOrderMeta({ order }: { order: SalesOrderDetail }) {
  return (
    <CardMetaStrip>
      {[
        <CardMetaValue
          key="created"
          label="Created"
          value={formatDate(toDateOnlyString(order.createdAt))}
          mono
        />,
        <CardMetaValue
          key="shipping"
          label="Shipping"
          value={order.shipDate ? formatDate(order.shipDate) : "—"}
          mono
        />,
        <CardMetaValue
          key="total"
          label="Order total"
          value={`${formatPrice(order.totalAmount) ?? "$0.00"} USD`}
          mono
        />,
      ]}
    </CardMetaStrip>
  );
}

type DraftHeaderPatch = Parameters<OrderDraftController["patchHeader"]>[0];
type PersistedHeaderPatch = Parameters<typeof patchSalesOrderHeader>[1];

function persistedDraftHeaderPatch(patch: DraftHeaderPatch): PersistedHeaderPatch {
  const { customerName, customerEmail, customerProjectName, ...persisted } = patch;
  void customerName;
  void customerEmail;
  void customerProjectName;
  return persisted;
}

function persistedOrderHeaderPatch(order: SalesOrderDetail): PersistedHeaderPatch {
  return {
    customerId: order.customerId,
    customerProjectId: order.customerProjectId,
    orderDate: order.orderDate,
    shipDate: order.shipDate,
    requestedDate: order.requestedDate,
    notes: order.notes,
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
    billingLine1: order.billingLine1,
    billingLine2: order.billingLine2,
    billingCity: order.billingCity,
    billingRegion: order.billingRegion,
    billingPostcode: order.billingPostcode,
    billingCountry: order.billingCountry,
  };
}

function makeInitialDraftOrder(
  timeZone: string,
  customerOptions: CustomerOption[],
  defaults: { customerId: string | null; projectId: string | null },
) {
  const draft = makeDraftOrder(timeZone);
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
