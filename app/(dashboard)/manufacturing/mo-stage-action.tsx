"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";

type ApiError = Error & {
  status: number;
  error: string;
};

export function MoStageAction({
  orderId,
  status,
  releasedAt,
  trigger,
  triggerAriaLabel,
  menuAlign = "end",
}: {
  orderId: string;
  status: ManufacturingOrderStatus;
  releasedAt: Date | null;
  trigger?: ReactNode;
  triggerAriaLabel?: string;
  menuAlign?: "start" | "center" | "end";
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);

  const releaseMutation = useMutation({
    mutationFn: async () => {
      await apiJson<void>(`/api/manufacturing-orders/${orderId}/release`, {
        method: "POST",
        idempotencyKey: `manufacturing-order-release-${orderId}`,
        body: {},
        fallbackError: "Failed to activate order.",
        mapError: (status, body) => {
          const payload = body as { error?: unknown } | null;
          const message =
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to activate order.";
          return Object.assign(new Error(message), {
            status,
            error: message,
          } satisfies Omit<ApiError, keyof Error>);
        },
      });
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.refresh();
    },
    onError: (error: ApiError) => {
      setActionError(error.error ?? "Failed to activate order.");
    },
  });

  if (trigger && status === "open") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
            aria-label={triggerAriaLabel ?? "Manufacturing order actions"}
          >
            {trigger}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={menuAlign} className="w-48">
          {releasedAt == null ? (
            <DropdownMenuItem
              disabled={releaseMutation.isPending}
              onSelect={(event) => {
                event.preventDefault();
                releaseMutation.mutate();
              }}
              className="py-2.5 text-lg"
            >
              {releaseMutation.isPending ? "Activating..." : "Activate"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild className="py-2.5 text-lg">
              <Link href={`/manufacturing/orders/${orderId}/execute`}>Execute</Link>
            </DropdownMenuItem>
          )}
          {actionError ? (
            <DropdownMenuItem
              disabled
              className="py-2.5 text-lg text-destructive"
            >
              {actionError}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (status === "open" && releasedAt == null) {
    return (
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            disabled={releaseMutation.isPending}
            onClick={(event) => {
              event.stopPropagation();
              releaseMutation.mutate();
            }}
          >
            {releaseMutation.isPending ? "Activating..." : "Activate"}
          </Button>
          {actionError ? (
            <p className="max-w-xs text-xs text-destructive">{actionError}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (status === "open") {
    return (
      <div className="flex justify-end">
        <Button size="sm" asChild>
          <Link href={`/manufacturing/orders/${orderId}/execute`}>Execute</Link>
        </Button>
      </div>
    );
  }

  return null;
}
