import { firstFieldErrorMessage } from "@/lib/api/field-errors";
import type { FlushOutcome } from "@/lib/card-kernel/kernel";

export type CardActionFlushPolicy = "none" | "requireSaved" | "tolerateBlocked";

export async function flushSavedCardOrThrow({
  flush,
  blockedMessage = "Unsaved changes can't be saved yet — fix them first.",
  fallbackError = "Save changes first.",
}: {
  flush?: () => Promise<FlushOutcome>;
  blockedMessage?: string;
  fallbackError?: string;
}) {
  const outcome = await flush?.();
  if (!outcome || outcome.outcome === "saved") return;
  if (outcome.outcome === "blocked") {
    throw new Error(
      firstFieldErrorMessage(outcome.fieldErrors, outcome.error || blockedMessage),
    );
  }
  throw new Error(outcome.error || fallbackError);
}

export async function flushClosableCardOrThrow({
  flush,
}: {
  flush?: () => Promise<FlushOutcome>;
}) {
  const outcome = await flush?.();
  if (!outcome || outcome.outcome === "saved" || outcome.outcome === "blocked") {
    return;
  }
  throw new Error(outcome.error);
}

export async function resolveCardActionId({
  flushPolicy,
  requiresPersistedId,
  flush,
  getId,
  missingIdError = "Save changes first.",
  blockedMessage,
}: {
  flushPolicy: CardActionFlushPolicy;
  requiresPersistedId: boolean;
  flush?: () => Promise<FlushOutcome>;
  getId?: () => string | null;
  missingIdError?: string;
  blockedMessage?: string;
}) {
  if (flushPolicy === "requireSaved") {
    await flushSavedCardOrThrow({
      flush,
      blockedMessage,
      fallbackError: missingIdError,
    });
  } else if (flushPolicy === "tolerateBlocked") {
    await flushClosableCardOrThrow({ flush });
  }

  if (!requiresPersistedId) return null;
  const id = getId?.() ?? null;
  if (!id) throw new Error(missingIdError);
  return id;
}

export async function resolveSavedCardId({
  flush,
  getId,
  missingIdError = "Save changes first.",
  blockedMessage,
}: {
  flush?: () => Promise<FlushOutcome>;
  getId: () => string | null;
  missingIdError?: string;
  blockedMessage?: string;
}): Promise<string> {
  const id = await resolveCardActionId({
    flushPolicy: "requireSaved",
    requiresPersistedId: true,
    flush,
    getId,
    missingIdError,
    blockedMessage,
  });
  if (!id) throw new Error(missingIdError);
  return id;
}

export async function runCardAction<TResult>({
  flushPolicy,
  requiresPersistedId,
  flush,
  getId,
  missingIdError,
  blockedMessage,
  run,
}: {
  flushPolicy: CardActionFlushPolicy;
  requiresPersistedId: boolean;
  flush?: () => Promise<FlushOutcome>;
  getId?: () => string | null;
  missingIdError?: string;
  blockedMessage?: string;
  run: (id: string | null) => Promise<TResult> | TResult;
}) {
  const id = await resolveCardActionId({
    flushPolicy,
    requiresPersistedId,
    flush,
    getId,
    missingIdError,
    blockedMessage,
  });
  return run(id);
}
