"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { getApiErrorMessage } from "@/lib/client/api";
import { formatQuantity } from "@/lib/format";
import {
  stockWarningDescription,
  stockWarningTitle,
} from "@/lib/sales/stock-warning-copy";
import type {
  NegativeStockWarningPayload,
  SalesOrderDetail,
  SalesShipmentRow,
} from "@/app/(dashboard)/sales/types";

export type MarkShippedDialogProps = {
  order: SalesOrderDetail;
  shipment: SalesShipmentRow | null;
  /** Whether Xero is connected + a sales account is configured. */
  xeroReady?: boolean;
  onClose: () => void;
};

export function MarkShippedDialog({
  order,
  shipment,
  xeroReady,
  onClose,
}: MarkShippedDialogProps) {
  const queryClient = useQueryClient();
  const [createInvoice, setCreateInvoice] = useState(false);
  const [negativeStock, setNegativeStock] =
    useState<NegativeStockWarningPayload | null>(null);

  const mutation = useMutation({
    mutationKey: ["sales-order-action", order.id, "ship", shipment?.id ?? ""],
    mutationFn: async (confirmNegativeStock: boolean) => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${shipment?.id}/ship`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...Object.fromEntries(
              createIdempotencyHeaders("shipSalesShipment").entries(),
            ),
          },
          body: JSON.stringify({
            confirmNegativeStock,
            syncAccounting: createInvoice,
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          status: response.status,
          message: getApiErrorMessage(body, "Failed to ship shipment."),
          negativeStock: body?.negativeStock as NegativeStockWarningPayload | undefined,
        };
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-order", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setNegativeStock(null);
      onClose();
    },
    onError: (error: {
      status?: number;
      message?: string;
      negativeStock?: NegativeStockWarningPayload;
    }) => {
      if (error.status === 409 && error.negativeStock) {
        setNegativeStock(error.negativeStock);
        return;
      }
    },
  });

  const open = shipment != null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setNegativeStock(null);
          setCreateInvoice(false);
          mutation.reset();
          onClose();
        }
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {negativeStock
              ? stockWarningTitle(negativeStock)
              : "Mark shipment shipped?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {negativeStock
              ? stockWarningDescription(negativeStock)
              : `${shipment?.shipmentNumber} will be marked shipped and inventory consumed via FIFO. This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {negativeStock?.commitments?.length ? (
          <div className="border border-border p-3 text-[length:var(--text-sm)]">
            <p className="font-medium">Current commitments</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {negativeStock.commitments.map((commitment) => (
                <li key={`${commitment.referenceType}:${commitment.referenceId}`}>
                  {commitment.label}: {formatQuantity(String(commitment.quantity))}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!negativeStock && xeroReady ? (
          <label className="flex items-center gap-(--space-2) text-[length:var(--text-sm)]">
            <Checkbox
              checked={createInvoice}
              onCheckedChange={(checked) => setCreateInvoice(checked === true)}
            />
            <span>Create Xero invoice if this completes the order</span>
          </label>
        ) : null}

        {mutation.isError && !negativeStock ? (
          <p className="text-[length:var(--text-sm)] text-destructive">
            {(mutation.error as { message?: string })?.message ??
              "Failed to ship shipment."}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate(negativeStock != null);
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? "Shipping…"
              : negativeStock
                ? "Ship anyway"
                : "Mark shipped"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
