"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { FlushOutcome } from "@/lib/card-kernel/kernel";
import { resolveCardActionId } from "./card-action-boundary";
export {
  flushClosableCardOrThrow,
  flushSavedCardOrThrow,
  resolveCardActionId,
  resolveSavedCardId,
  runCardAction,
  type CardActionFlushPolicy,
} from "./card-action-boundary";
import type { CardHeaderAction } from "./card-page-header";
import { useConfirmMutation } from "./use-confirm-mutation";
import { useDeleteEntity } from "./use-delete-entity";
import { useDuplicateEntity } from "./use-duplicate-entity";

type QueryKey = readonly unknown[];

/**
 * Standard duplicate/delete header actions for card pages. Every action
 * flushes the kernel first, then branches on the flush outcome before
 * resolving the persisted id: a `failed`/`conflict` flush aborts the action
 * with its message, and a `blocked` (validation) flush aborts duplicate —
 * copying unsaved state would lie — but not delete, which discards the draft
 * anyway. Returns ready-made CardHeaderAction entries plus the confirm
 * dialog node to render.
 *
 *   const actions = useCardEntityActions({
 *     entity: "supplier-action",
 *     getId: () => currentSupplierId,
 *     flush: kernel.flush,
 *     invalidateQueryKeys: [queryKeys.suppliers.root],
 *     delete: {
 *       label: "Delete supplier",
 *       run: (id) => deleteSupplier(id),
 *       navigateTo: "/purchasing/suppliers",
 *       confirm: { title: "Delete supplier?", description: <>…</> },
 *     },
 *   });
 *   <CardPageHeader menuActions={[printAction, actions.deleteAction]} … />
 *   {actions.dialogs}
 */
export function useCardEntityActions({
  entity,
  getId,
  flush,
  invalidateQueryKeys,
  missingIdError = "Save changes first.",
  onMutate,
  onError,
  duplicate,
  delete: deleteConfig,
}: {
  entity: string;
  getId: () => string | null;
  /** The kernel flush; the actions branch on its outcome. */
  flush?: () => Promise<FlushOutcome>;
  invalidateQueryKeys: readonly QueryKey[];
  missingIdError?: string;
  onMutate?: () => void;
  onError?: (error: Error) => void;
  duplicate?: {
    label?: string;
    run: (id: string) => Promise<{ id: string }>;
    navigateTo: (id: string) => string;
  };
  delete?: {
    label?: string;
    run: (id: string) => Promise<unknown>;
    navigateTo?: string;
    onDeleted?: () => void;
    confirm: {
      title: ReactNode;
      description: ReactNode;
      confirmLabel?: ReactNode;
      pendingLabel?: ReactNode;
      cancelLabel?: ReactNode;
    };
  };
}): {
  duplicateAction: CardHeaderAction | null;
  deleteAction: CardHeaderAction | null;
  dialogs: ReactNode;
} {
  const router = useRouter();
  const currentId = getId();

  const resolveId = async ({ requireSaved = false } = {}): Promise<string> => {
    const id = await resolveCardActionId({
      flushPolicy: requireSaved ? "requireSaved" : "tolerateBlocked",
      requiresPersistedId: true,
      flush,
      getId,
      missingIdError,
    });
    if (!id) throw new Error(missingIdError);
    return id;
  };

  const duplicateMutation = useDuplicateEntity({
    mutationKey: [entity, currentId ?? "__draft__", "duplicate"],
    mutationFn: async () => {
      if (!duplicate) throw new Error("Duplicate is not configured.");
      return duplicate.run(await resolveId({ requireSaved: true }));
    },
    invalidateQueryKeys,
    onDuplicated: (created) => {
      if (duplicate) router.push(duplicate.navigateTo(created.id));
    },
    onMutate,
    onError,
  });

  const deleteMutation = useDeleteEntity({
    mutationKey: [entity, currentId ?? "__draft__", "delete"],
    mutationFn: async () => {
      if (!deleteConfig) throw new Error("Delete is not configured.");
      await deleteConfig.run(await resolveId());
    },
    invalidateQueryKeys,
    onDeleted: () => {
      if (!deleteConfig) return;
      if (deleteConfig.onDeleted) deleteConfig.onDeleted();
      else if (deleteConfig.navigateTo) router.push(deleteConfig.navigateTo);
    },
    onMutate,
    onError,
  });

  const deleteConfirm = useConfirmMutation<void>({
    title: deleteConfig?.confirm.title ?? "Delete?",
    description: deleteConfig?.confirm.description ?? null,
    confirmLabel: deleteConfig?.confirm.confirmLabel ?? "Delete",
    pendingLabel: deleteConfig?.confirm.pendingLabel ?? "Deleting...",
    cancelLabel: deleteConfig?.confirm.cancelLabel ?? "Cancel",
    mutation: deleteMutation,
  });

  return {
    duplicateAction: duplicate
      ? {
          label: duplicate.label ?? "Duplicate",
          onClick: () => duplicateMutation.mutate(),
          disabled: duplicateMutation.isPending,
        }
      : null,
    deleteAction: deleteConfig
      ? {
          label: deleteConfig.label ?? "Delete",
          destructive: true,
          onClick: () => deleteConfirm.trigger(undefined),
        }
      : null,
    dialogs: deleteConfig ? deleteConfirm.dialog : null,
  };
}
