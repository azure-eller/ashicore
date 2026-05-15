"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson, getApiErrorMessage } from "@/lib/client/api";

type ConfirmError = Error & {
  status: number;
  error: string;
};

type ConfirmFlags = {
  confirmOversell?: boolean;
};

export function useConfirmSalesOrderFlow(
  orderId: string,
  options?: { onSuccess?: () => void }
) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<ConfirmError | null>(null);

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
          const payload = body as { error?: unknown } | null;
          const message = getApiErrorMessage(payload, "Failed to confirm order.");
          return Object.assign(new Error(message), {
            status,
            error: message,
          } satisfies Omit<ConfirmError, keyof Error>);
        },
      });
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await refreshSalesList();
      options?.onSuccess?.();
    },
    onError: (error: ConfirmError) => {
      setActionError(error);
    },
  });

  return {
    confirm: () => confirmMutation.mutate({}),
    isPending: confirmMutation.isPending,
    errorMessage: actionError?.error ?? null,
    dialogs: null,
  };
}
