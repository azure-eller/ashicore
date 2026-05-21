"use client";

import type { MutationKey } from "@tanstack/react-query";
import { useMutationState } from "@tanstack/react-query";

import styles from "./card-page.module.css";

export type CardSaveState = "not_saved" | "saving" | "saved" | "failed" | "readonly";

export type EntitySaveStatus = {
  status: "idle" | "saving" | "error";
  pendingCount: number;
  errorCount: number;
};

export function cardSaveMutationKey(
  entityKey: string,
  entityId: string,
  ...scope: Array<string | number | null | undefined>
): MutationKey {
  return ["card-save", entityKey, entityId, ...scope.filter((part) => part != null)];
}

export function useEntitySaveStatus(entityKey: string, entityId: string): EntitySaveStatus {
  const states = useMutationState({
    filters: {
      mutationKey: cardSaveMutationKey(entityKey, entityId),
      exact: false,
    },
    select: (mutation) => ({
      status: mutation.state.status,
      submittedAt: mutation.state.submittedAt,
    }),
  });
  const pendingCount = states.filter((state) => state.status === "pending").length;
  const errorCount = states.filter((state) => state.status === "error").length;
  const latest = states
    .filter((state) => state.submittedAt > 0)
    .sort((a, b) => a.submittedAt - b.submittedAt)
    .at(-1);

  if (latest?.status === "pending") {
    return { status: "saving", pendingCount, errorCount };
  }
  if (latest?.status === "error") {
    return { status: "error", pendingCount, errorCount };
  }
  return { status: "idle", pendingCount, errorCount };
}

export function CardSaveStatusIndicator({
  state,
  message,
}: {
  state: CardSaveState;
  message?: string | null;
}) {
  const className =
    state === "saved" || state === "readonly"
      ? styles.savedPill
      : state === "saving"
        ? styles.savingPill
        : styles.failedPill;
  const label =
    message ??
    (state === "saved"
      ? "Saved"
      : state === "saving"
        ? "Saving..."
        : state === "not_saved"
          ? "Not saved yet"
          : state === "readonly"
            ? "Read-only"
            : "Save failed");

  return (
    <span className={className}>
      <span className={styles.pillSquare} /> {label}
    </span>
  );
}

export function saveStateFromEntityStatus(
  status: EntitySaveStatus["status"],
): CardSaveState {
  if (status === "saving") return "saving";
  if (status === "error") return "failed";
  return "saved";
}
