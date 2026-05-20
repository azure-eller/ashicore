"use client";

import { useIsMutating, useMutationState } from "@tanstack/react-query";

export type MoSaveStatus = "idle" | "saving" | "error";

/**
 * Aggregates every in-flight MO mutation keyed `["mo", moId, ...]`. Mirrors
 * the item-card `useCardSaveStatus` hook — header pill reads from this.
 */
export function useMoSaveStatus(moId: string): {
  status: MoSaveStatus;
  pendingCount: number;
  errorCount: number;
} {
  const pendingCount = useIsMutating({
    mutationKey: ["mo", moId],
    exact: false,
  });

  const errorStates = useMutationState({
    filters: {
      mutationKey: ["mo", moId],
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
