"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
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
  updateSalesOrderFull,
} from "@/lib/api/clients/sales-orders";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import type {
  CustomerOption,
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderItemOption,
  SalesShipmentRow,
} from "@/app/(dashboard)/sales/types";
import { OrderCardHeader } from "./order-card-header";
import { OrderDetailsGrid } from "./order-details-grid";
import { LineItemsTable } from "./line-items-table";
import { ShipmentsTable } from "./shipments-table";
import { TotalsStrip } from "./totals-strip";
import { PlanShipmentDialog } from "./plan-shipment-dialog";
import { MarkShippedDialog } from "./mark-shipped-dialog";
import {
  draftToInsertPayload,
  makeDraftLine,
  makeDraftOrder,
  orderToUpdatePayload,
  type OrderDraftController,
} from "./order-draft";
import cardStyles from "@/components/card-page/card-page.module.css";

export type XeroInvoiceSetupStatus =
  | "not_connected"
  | "missing_sales_account"
  | "ready";

export type OrderCardProps = {
  /** null on the /sales/order draft route. */
  initialOrder: SalesOrderDetail | null;
  customerOptions: CustomerOption[];
  itemOptions: SalesOrderItemOption[];
  canViewLedger?: boolean;
  xeroInvoiceSetupStatus?: XeroInvoiceSetupStatus;
};

export function OrderCard({
  initialOrder,
  customerOptions,
  itemOptions,
  xeroInvoiceSetupStatus,
}: OrderCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const timeZone = useOrganizationTimeZone();

  const [currentOrderId, setCurrentOrderId] = useState<string | null>(
    initialOrder?.id ?? null,
  );
  const [draftOrder, setDraftOrder] = useState<SalesOrderDetail>(
    () => initialOrder ?? makeDraftOrder(timeZone),
  );
  const isDraft = currentOrderId == null;

  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shipmentDialogTarget, setShipmentDialogTarget] = useState<
    "new" | SalesShipmentRow | null
  >(null);
  const [shipTarget, setShipTarget] = useState<SalesShipmentRow | null>(null);

  const orderQuery = useQuery({
    queryKey: ["sales-order", currentOrderId ?? "__draft__"],
    queryFn: () => fetchSalesOrderDetail(currentOrderId as string),
    initialData: initialOrder ?? undefined,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const order = isDraft ? draftOrder : orderQuery.data ?? draftOrder;

  const isEditable =
    isDraft ||
    (order.status !== "done" && order.shippingReadiness.state !== "shipped");

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

  const draftController = useMemo<OrderDraftController>(
    () => ({
      patchHeader: (patch) =>
        setDraftOrder((prev) => ({ ...prev, ...patch }) as SalesOrderDetail),
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
    }),
    [recomputeTotals],
  );

  const createMutation = useMutation({
    mutationKey: ["sales-order", "__draft__", "create"],
    mutationFn: async () => {
      const created = await createSalesOrder(draftToInsertPayload(draftOrder));
      const detail = await fetchSalesOrderDetail(created.id);
      return detail;
    },
    onMutate: () => setActionError(null),
    onSuccess: (detail) => {
      setCurrentOrderId(detail.id);
      queryClient.setQueryData(["sales-order", detail.id], detail);
      void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      window.history.replaceState(null, "", `/sales/orders/${detail.id}`);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const canCreate =
    draftOrder.customerId.trim().length > 0 &&
    draftOrder.lines.length > 0 &&
    draftOrder.lines.every(
      (line) => Number(line.quantity) > 0 && Number(line.unitPrice) >= 0,
    );

  // ---- Live mutations ----------------------------------------------------
  const deleteMutation = useMutation({
    mutationKey: ["sales-order", currentOrderId ?? "draft", "delete"],
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
    mutationKey: ["sales-order", currentOrderId ?? "draft", "duplicate"],
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
    mutationKey: ["sales-order", currentOrderId ?? "draft", "delete-line"],
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
    mutationKey: ["sales-order", currentOrderId ?? "draft", "add-line"],
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

  return (
    <div className={cardStyles.sheet}>
      <OrderCardHeader
        order={isDraft ? null : order}
        mode={isDraft ? "draft" : "edit"}
        draftCustomerName={draftOrder.customerName || null}
        draftIsDirty={isDraft && (draftOrder.customerId !== "" || draftOrder.lines.length > 0)}
        draftSaving={createMutation.isPending}
        draftHasError={createMutation.isError}
        onCreate={isDraft ? () => createMutation.mutate() : undefined}
        onCreateDisabled={!canCreate || createMutation.isPending}
        onPlanShipment={
          !isDraft && isEditable ? () => setShipmentDialogTarget("new") : undefined
        }
        onDuplicate={!isDraft ? () => duplicateMutation.mutate() : undefined}
        onDelete={!isDraft ? () => setConfirmDelete(true) : undefined}
      />

      {actionError ? (
        <div className="px-(--space-5) py-(--space-3) bg-[var(--color-danger-soft)] text-destructive text-sm border-b border-[var(--color-line)]">
          {actionError}
        </div>
      ) : null}

      <div className={cardStyles.body}>
        <OrderDetailsGrid
          order={order}
          editable={isEditable}
          customerOptions={customerOptions}
          draft={isDraft ? draftController : undefined}
        />

        <LineItemsTable
          order={order}
          editable={isEditable}
          itemOptions={itemOptions}
          draft={isDraft ? draftController : undefined}
          onAddLineItem={!isDraft && isEditable ? handleAddLineItem : undefined}
          addingLine={addLineMutation.isPending}
          onDeleteLine={isEditable ? handleDeleteLine : undefined}
          deletingLineId={
            deleteLineMutation.isPending
              ? deleteLineMutation.variables?.id ?? null
              : null
          }
        />

        {isDraft ? null : (
          <ShipmentsTable
            order={order}
            editable={isEditable}
            onNewShipment={isEditable ? () => setShipmentDialogTarget("new") : undefined}
            onEditShipment={
              isEditable ? (shipment) => setShipmentDialogTarget(shipment) : undefined
            }
            onMarkShipped={isEditable ? (shipment) => setShipTarget(shipment) : undefined}
            onEditCosts={
              isEditable
                ? () => router.push(`/sales/orders/${currentOrderId}/edit`)
                : undefined
            }
            onPushXero={
              isEditable
                ? () => router.push(`/sales/orders/${currentOrderId}/edit`)
                : undefined
            }
            onDeleteShipment={
              isEditable
                ? () => router.push(`/sales/orders/${currentOrderId}/edit`)
                : undefined
            }
          />
        )}

        <TotalsStrip
          order={order}
          notesEditable={isEditable}
          draft={isDraft ? draftController : undefined}
        />
      </div>

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
    </div>
  );
}
