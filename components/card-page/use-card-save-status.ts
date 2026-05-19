"use client";

import { useIsMutating, useMutationState } from "@tanstack/react-query";

export type CardSaveStatus = "idle" | "saving" | "error";

/**
 * Lightweight aggregator for per-card save state. Every mutation that targets
 * a particular item card should use mutationKey `["item-card", itemId, ...]`;
 * this hook surfaces "saving" while any are in flight and "error" when the
 * most recent settled one failed.
 *
 * The card header reads this. No global store; no retry queue. To retry the
 * failed save, the user re-edits the field.
 */
export function useCardSaveStatus(itemId: string): {
  status: CardSaveStatus;
  pendingCount: number;
  errorCount: number;
} {
  const pendingCount = useIsMutating({
    mutationKey: ["item-card", itemId],
    exact: false,
  });

  const errorStates = useMutationState({
    filters: {
      mutationKey: ["item-card", itemId],
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
