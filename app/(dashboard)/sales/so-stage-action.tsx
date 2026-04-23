"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { Button } from "@/components/ui/button";
import { DisabledTooltipButton } from "@/components/disabled-tooltip-button";
import type { SalesOrderListRow } from "./types";

type ActionError = {
  status: number;
  error: string;
  hasOversell: boolean;
};

type Props = {
  order: Pick<
    SalesOrderListRow,
    "id" | "status" | "hasManufacturableLines" | "manufacturableDisabledReason"
  >;
};

export function SoStageAction({ order }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<ActionError | null>(null);

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
    return (
      <div className="flex items-center justify-end gap-2">
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            disabled={shipMutation.isPending}
            onClick={(event) => {
              event.stopPropagation();
              shipMutation.mutate();
            }}
          >
            {shipMutation.isPending ? "Shipping..." : "Ship"}
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
        {order.hasManufacturableLines ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/manufacturing/orders/new?salesOrderId=${order.id}`}>
              Create MOs
            </Link>
          </Button>
        ) : (
          <DisabledTooltipButton
            label="Create MOs"
            tooltip={
              order.manufacturableDisabledReason ??
              "No manufacturable lines remain on this order."
            }
            variant="ghost"
          />
        )}
      </div>
    );
  }

  return null;
}
