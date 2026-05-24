"use client";

import { useEntitySaveStatus, type EntitySaveStatus } from "./card-save-status";

export type CardSaveStatus = EntitySaveStatus["status"];

/**
 * Lightweight aggregator for per-card save state. Editable card persistence
 * mutations should use `cardSaveMutationKey("item-card", itemId, ...)`;
 * workflow and inventory actions should keep their own domain action keys.
 *
 * The card header reads this. No global store; no retry queue. To retry the
 * failed save, the user re-edits the field.
 */
export function useCardSaveStatus(itemId: string): {
  status: CardSaveStatus;
  pendingCount: number;
  errorCount: number;
  errorMessage: string | null;
} {
  return useEntitySaveStatus("item-card", itemId);
}
