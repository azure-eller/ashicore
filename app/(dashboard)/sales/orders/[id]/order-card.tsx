"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { fetchSalesOrderDetail } from "@/lib/api/clients/sales-orders";
import type {
  CustomerOption,
  SalesOrderDetail,
  SalesOrderDetailLine,
} from "@/app/(dashboard)/sales/types";
import { buildSalesOrderLineRemovalPayload } from "@/app/(dashboard)/sales/order-line-removal";
import { OrderCardHeader } from "./order-card-header";
import { OrderDetailsGrid } from "./order-details-grid";
import { LineItemsTable } from "./line-items-table";
import { ShipmentsTable } from "./shipments-table";
import { TotalsStrip } from "./totals-strip";
import cardStyles from "@/components/card-page/card-page.module.css";

export type XeroInvoiceSetupStatus =
  | "not_connected"
  | "missing_sales_account"
  | "ready";

export type OrderCardProps = {
  initialOrder: SalesOrderDetail;
  customerOptions: CustomerOption[];
  canViewLedger?: boolean;
  xeroInvoiceSetupStatus?: XeroInvoiceSetupStatus;
};

export function OrderCard({ initialOrder, customerOptions }: OrderCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const orderQuery = useQuery({
    queryKey: ["sales-order", initialOrder.id],
    queryFn: () => fetchSalesOrderDetail(initialOrder.id),
    initialData: initialOrder,
    refetchOnWindowFocus: false,
  });
  const order = orderQuery.data ?? initialOrder;

  const isEditable =
    order.status !== "done" && order.shippingReadiness.state !== "shipped";

  const deleteMutation = useMutation({
    mutationKey: ["sales-order", order.id, "delete"],
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
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      router.push("/sales/orders");
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const duplicateMutation = useMutation({
    mutationKey: ["sales-order", order.id, "duplicate"],
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
    onMutate: () => setActionError(null),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      router.push(`/sales/orders/${created.id}`);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const deleteLineMutation = useMutation({
    mutationKey: ["sales-order", order.id, "delete-line"],
    mutationFn: async (line: SalesOrderDetailLine) => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...createIdempotencyHeaders("sales-order-line-delete"),
        },
        body: JSON.stringify(buildSalesOrderLineRemovalPayload(order, line.id)),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete line.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["sales-order", order.id],
      });
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  // Line item + shipment editing still bounce to the legacy form until those
  // dialogs land. Header/notes are now fully inline-edited via PATCH.
  const goToLegacyEdit = () => router.push(`/sales/orders/${order.id}/edit`);

  return (
    <div className={cardStyles.sheet}>
      <OrderCardHeader
        order={order}
        mode="edit"
        onPlanShipment={isEditable ? goToLegacyEdit : undefined}
        onPlanShipmentDisabled={false}
        onDuplicate={() => duplicateMutation.mutate()}
        onDelete={() => setConfirmDelete(true)}
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
        />

        <LineItemsTable
          order={order}
          editable={isEditable}
          onAddLine={isEditable ? goToLegacyEdit : undefined}
          onDeleteLine={
            isEditable
              ? async (line) => {
                  await deleteLineMutation.mutateAsync(line);
                }
              : undefined
          }
          deletingLineId={
            deleteLineMutation.isPending
              ? deleteLineMutation.variables?.id ?? null
              : null
          }
        />

        <ShipmentsTable
          order={order}
          editable={isEditable}
          onNewShipment={isEditable ? goToLegacyEdit : undefined}
          onEditShipment={isEditable ? goToLegacyEdit : undefined}
          onMarkShipped={isEditable ? goToLegacyEdit : undefined}
          onEditCosts={isEditable ? goToLegacyEdit : undefined}
          onPushXero={isEditable ? goToLegacyEdit : undefined}
          onDeleteShipment={isEditable ? goToLegacyEdit : undefined}
        />

        <TotalsStrip order={order} notesEditable={isEditable} />
      </div>

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
