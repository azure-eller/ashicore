"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { Button } from "@/components/ui/button";
import { DisabledTooltipButton } from "@/components/disabled-tooltip-button";
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
import type { SalesOrderListRow } from "./types";

type ActionError = {
  status: number;
  error: string;
  hasOversell: boolean;
};

type Props = {
  order: Pick<
    SalesOrderListRow,
    | "id"
    | "orderNumber"
    | "customerName"
    | "status"
    | "hasManufacturableLines"
    | "manufacturableDisabledReason"
    | "shippingReadiness"
  >;
};

export function SoStageAction({ order }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [shipOpen, setShipOpen] = useState(false);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        headers: createIdempotencyHeaders(`sales-order-confirm-${order.id}`, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ confirmOversell: false }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to confirm order.",
          hasOversell: Boolean(body?.oversell),
        } satisfies ActionError;
      }
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setShipOpen(false);
      router.refresh();
    },
    onError: (error: ActionError) => setActionError(error),
  });

  const shipMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}/ship`, {
        method: "POST",
        headers: createIdempotencyHeaders(`sales-order-ship-${order.id}`),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to ship order.",
          hasOversell: false,
        } satisfies ActionError;
      }
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.refresh();
    },
    onError: (error: ActionError) => setActionError(error),
  });

  const errorMessage = actionError
    ? actionError.hasOversell
      ? "Oversell — review on the order"
      : actionError.error
    : null;

  if (order.status === "draft") {
    return (
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            disabled={confirmMutation.isPending}
            onClick={(event) => {
              event.stopPropagation();
              confirmMutation.mutate();
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
    );
  }

  if (order.status === "confirmed") {
    const canShip = order.shippingReadiness.state === "ready";
    const shouldCreateMOs = order.shippingReadiness.state === "needs_manufacturing";
    const shouldWaitForProduction = order.shippingReadiness.state === "in_production";

    return (
      <>
      <div className="flex items-center justify-end gap-2">
        <div className="flex flex-col items-end gap-1">
          {canShip ? (
            <Button
              size="sm"
              disabled={shipMutation.isPending}
              onClick={(event) => {
                event.stopPropagation();
                setShipOpen(true);
              }}
            >
              {shipMutation.isPending ? "Shipping..." : "Ship"}
            </Button>
          ) : shouldWaitForProduction ? (
            <DisabledTooltipButton
              label="In production"
              tooltip={order.shippingReadiness.message}
            />
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/sales/orders/${order.id}`}>Review</Link>
            </Button>
          )}
          {errorMessage ? (
            <Link
              href={`/sales/orders/${order.id}`}
              className="max-w-xs text-xs text-destructive hover:underline"
            >
              {errorMessage}
            </Link>
          ) : null}
        </div>
        {shouldCreateMOs ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/manufacturing/orders/new?salesOrderId=${order.id}`}>
              Create MOs
            </Link>
          </Button>
        ) : order.hasManufacturableLines ? (
          <DisabledTooltipButton
            label="Create MOs"
            tooltip={
              order.manufacturableDisabledReason ??
              "No manufacturable lines remain on this order."
            }
            variant="ghost"
          />
        ) : null}
      </div>
      <AlertDialog open={shipOpen} onOpenChange={setShipOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ship {order.orderNumber}</AlertDialogTitle>
            <AlertDialogDescription>
              Shipping consumes stock FIFO and marks this sales order shipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{order.customerName}</span>
            <span className="text-muted-foreground">{order.shippingReadiness.message}</span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={shipMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canShip || shipMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                shipMutation.mutate();
              }}
            >
              {shipMutation.isPending ? "Shipping..." : "Ship order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
    );
  }

  return null;
}
