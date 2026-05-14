"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson, getApiErrorMessage } from "@/lib/client/api";
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
} from "./types";
import {
  OVERSELL_WARNING_DESCRIPTION,
  OversellWarningTable,
} from "./oversell-warning-table";

type ConfirmError = Error & {
  status: number;
  error: string;
  oversell?: OversellWarningPayload;
  draftAllocationTakeover?: DraftAllocationTakeoverWarningPayload;
};

type ConfirmFlags = {
  confirmOversell?: boolean;
  confirmDraftAllocationTakeover?: boolean;
};

export function useConfirmSalesOrderFlow(
  orderId: string,
  options?: { onSuccess?: () => void }
) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<ConfirmError | null>(null);
  const [oversellWarning, setOversellWarning] =
    useState<OversellWarningPayload | null>(null);
  const [draftTakeoverWarning, setDraftTakeoverWarning] =
    useState<DraftAllocationTakeoverWarningPayload | null>(null);

  const refreshSalesList = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-order", orderId] }),
      queryClient.invalidateQueries({ queryKey: ["sales-order-detail", orderId] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    router.refresh();
  };

  const confirmMutation = useMutation({
    mutationFn: async (flags: ConfirmFlags) => {
      await apiJson<void>(`/api/sales-orders/${orderId}/confirm`, {
        method: "POST",
        idempotencyKey: `sales-order-confirm-${orderId}`,
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
          const message = getApiErrorMessage(payload, "Failed to confirm order.");
          return Object.assign(new Error(message), {
            status,
            error: message,
            oversell: payload?.oversell,
            draftAllocationTakeover: payload?.draftAllocationTakeover,
          } satisfies Omit<ConfirmError, keyof Error>);
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
      options?.onSuccess?.();
    },
    onError: (error: ConfirmError) => {
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

  return {
    confirm: () => confirmMutation.mutate({}),
    isPending: confirmMutation.isPending,
    errorMessage: actionError?.error ?? null,
    dialogs: (
      <>
        <AlertDialog
          open={oversellWarning != null}
          onOpenChange={(open) => {
            if (!open) setOversellWarning(null);
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
                onClick={() => confirmMutation.mutate({ confirmOversell: true })}
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
    ),
  };
}
