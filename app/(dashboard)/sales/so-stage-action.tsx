"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
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
};

type Props = {
  order: Pick<
    SalesOrderListRow,
    | "id"
    | "status"
    | "hasManufacturableLines"
    | "shippingReadiness"
  >;
};

export function SoStageAction({ order }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [oversellWarning, setOversellWarning] =
    useState<OversellWarningPayload | null>(null);

  const refreshSalesList = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    router.refresh();
  };

  const confirmMutation = useMutation({
    mutationFn: async (confirmOversell: boolean) => {
      await apiJson<void>(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        idempotencyKey: `sales-order-confirm-${order.id}`,
        body: { confirmOversell },
        fallbackError: "Failed to confirm order.",
        mapError: (status, body) => {
          const payload = body as { error?: unknown; oversell?: OversellWarningPayload } | null;
          const message =
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to confirm order.";
          return Object.assign(new Error(message), {
            status,
            error: message,
            oversell: payload?.oversell,
          } satisfies Omit<ActionError, keyof Error>);
        },
      });
    },
    onMutate: () => {
      setActionError(null);
      setOversellWarning(null);
    },
    onSuccess: async () => {
      await refreshSalesList();
    },
    onError: (error: ActionError) => {
      if (error.status === 409 && error.oversell) {
        setOversellWarning(error.oversell);
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
                confirmMutation.mutate(false);
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
                onClick={() => confirmMutation.mutate(true)}
              >
                {confirmMutation.isPending ? "Confirming..." : "Confirm Anyway"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (order.status === "confirmed" || order.status === "partially_shipped") {
    if (!order.hasManufacturableLines) {
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
