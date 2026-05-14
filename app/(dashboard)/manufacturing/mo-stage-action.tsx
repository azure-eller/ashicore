"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";

type ApiError = Error & {
  status: number;
  error: string;
};

export function MoStageAction({
  orderId,
  status,
}: {
  orderId: string;
  status: ManufacturingOrderStatus;
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

  if (status === "draft") {
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

  if (status === "released") {
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
