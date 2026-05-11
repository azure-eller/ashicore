"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson, getApiErrorMessage } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
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
import type {
  DraftAllocationTakeoverWarningPayload,
  OversellWarningPayload,
  SalesOrderListRow,
} from "./types";
import {
  OVERSELL_WARNING_DESCRIPTION,
  OversellWarningTable,
} from "./oversell-warning-table";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";

type ActionError = Error & {
  status: number;
  error: string;
  oversell?: OversellWarningPayload;
  draftAllocationTakeover?: DraftAllocationTakeoverWarningPayload;
};

type Props = {
  order: Pick<
    SalesOrderListRow,
    | "id"
    | "status"
    | "hasManufacturableLines"
    | "fulfillmentSummary"
    | "shippingReadiness"
  >;
};

export function SoStageAction({ order }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [oversellWarning, setOversellWarning] =
    useState<OversellWarningPayload | null>(null);
  const [draftTakeoverWarning, setDraftTakeoverWarning] =
    useState<DraftAllocationTakeoverWarningPayload | null>(null);

  const refreshSalesList = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    router.refresh();
  };

  const confirmMutation = useMutation({
    mutationFn: async (flags: {
      confirmOversell?: boolean;
      confirmDraftAllocationTakeover?: boolean;
    }) => {
      await apiJson<void>(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        idempotencyKey: `sales-order-confirm-${order.id}`,
        body: flags,
        fallbackError: "Failed to confirm order.",
        mapError: (status, body) => {
          const payload = body as
            | {
                error?: unknown;
                oversell?: OversellWarningPayload;
                draftAllocationTakeover?: DraftAllocationTakeoverWarningPayload;
              }
            | null;
          const message =
            getApiErrorMessage(payload, "Failed to confirm order.");
          return Object.assign(new Error(message), {
            status,
            error: message,
            oversell: payload?.oversell,
            draftAllocationTakeover: payload?.draftAllocationTakeover,
          } satisfies Omit<ActionError, keyof Error>);
        },
      });
    },
    onMutate: () => {
      setActionError(null);
      setOversellWarning(null);
      setDraftTakeoverWarning(null);
    },
    onSuccess: async () => {
      await refreshSalesList();
    },
    onError: (error: ActionError) => {
      if (error.status === 409 && error.oversell) {
        setOversellWarning(error.oversell);
        return;
      }
      if (error.status === 409 && error.draftAllocationTakeover) {
        setDraftTakeoverWarning(error.draftAllocationTakeover);
        return;
      }

      setActionError(error);
    },
  });

  const errorMessage = actionError?.error ?? null;

  if (order.status === "draft") {
    return (
      <>
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={confirmMutation.isPending}
              onClick={(event) => {
                event.stopPropagation();
                confirmMutation.mutate({});
              }}
            >
              {confirmMutation.isPending ? "Confirming..." : "Confirm"}
            </Button>
            {errorMessage ? (
              <Link
                href={`/sales/orders/${order.id}`}
                className="max-w-xs text-xs text-destructive hover:underline"
              >
                {errorMessage}
              </Link>
            ) : null}
          </div>
        </div>
        <AlertDialog
          open={oversellWarning != null}
          onOpenChange={(open) => {
            if (!open) {
              setOversellWarning(null);
            }
          }}
        >
          <AlertDialogContent
            size="2xl"
            className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
          >
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
                onClick={() =>
                  confirmMutation.mutate({ confirmOversell: true })
                }
              >
                {confirmMutation.isPending ? "Confirming..." : "Confirm Anyway"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={draftTakeoverWarning != null}
          onOpenChange={(open) => {
            if (!open) setDraftTakeoverWarning(null);
          }}
        >
          <AlertDialogContent
            size="2xl"
            className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Take Draft Allocations?</AlertDialogTitle>
              <AlertDialogDescription>
                Confirming this order will reduce stock allocated to draft orders.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 text-sm">
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
      </>
    );
  }

  if (order.status === "confirmed" || order.status === "partially_shipped") {
    if (
      !order.hasManufacturableLines ||
      Number(order.fulfillmentSummary.shortQty) <= 0
    ) {
      return null;
    }

    return (
      <>
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center justify-end gap-2">
              <CreateManufacturingOrdersDialog
                salesOrderId={order.id}
                buttonVariant="secondary"
              />
            </div>
            {errorMessage ? (
              <Link
                href={`/sales/orders/${order.id}`}
                className="max-w-xs text-xs text-destructive hover:underline"
              >
                {errorMessage}
              </Link>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return null;
}
