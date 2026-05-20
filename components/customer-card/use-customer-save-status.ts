"use client";

import { useIsMutating, useMutationState } from "@tanstack/react-query";

export type CustomerSaveStatus = "idle" | "saving" | "error";

export function useCustomerSaveStatus(customerId: string): CustomerSaveStatus {
  const pendingCount = useIsMutating({
    mutationKey: ["customer-card", customerId],
    exact: false,
  });
  const errors = useMutationState({
    filters: {
      mutationKey: ["customer-card", customerId],
      exact: false,
      status: "error",
    },
  });

  if (pendingCount > 0) return "saving";
  if (errors.length > 0) return "error";
  return "idle";
}
