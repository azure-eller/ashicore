"use client";

import { useIsMutating, useMutationState } from "@tanstack/react-query";

export type SalesOrderSaveStatus = "idle" | "saving" | "error";

export function useSalesOrderSaveStatus(orderId: string): {
  status: SalesOrderSaveStatus;
  pendingCount: number;
  errorCount: number;
} {
  const pendingCount = useIsMutating({
    mutationKey: ["sales-order", orderId],
    exact: false,
  });
  const errorStates = useMutationState({
    filters: {
      mutationKey: ["sales-order", orderId],
      exact: false,
      status: "error",
    },
  });

  if (pendingCount > 0) {
    return { status: "saving", pendingCount, errorCount: errorStates.length };
  }
  if (errorStates.length > 0) {
    return { status: "error", pendingCount: 0, errorCount: errorStates.length };
  }
  return { status: "idle", pendingCount: 0, errorCount: 0 };
}
