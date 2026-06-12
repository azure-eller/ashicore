"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { CardHeaderAction } from "./card-page-header";
import { useConfirmMutation } from "./use-confirm-mutation";
import { useDeleteEntity } from "./use-delete-entity";
import { useDuplicateEntity } from "./use-duplicate-entity";

type QueryKey = readonly unknown[];

/**
 * Standard duplicate/delete header actions for card pages. Every action
 * flushes the draft engine first, then resolves the persisted id — so a
 * pending edit is saved (or its validation error aborts the action) before
 * the endpoint runs. Returns ready-made CardHeaderAction entries plus the
 * confirm dialog node to render.
 *
 *   const actions = useCardEntityActions({
 *     entity: "supplier-action",
 *     getId: () => currentSupplierId,
 *     flush: engine.flush,
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
  hasPendingOps,
  invalidateQueryKeys,
  missingIdError = "Save changes first.",
  onMutate,
  onError,
  duplicate,
  delete: deleteConfig,
}: {
  entity: string;
  getId: () => string | null;
  flush?: () => Promise<void>;
  /** Lets duplicate refuse to copy stale server state when a flush no-ops
   *  (e.g. the draft is currently unsaveable). Delete ignores pending edits. */
  hasPendingOps?: () => boolean;
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

  const resolveId = async ({ requireFlushed = false } = {}) => {
    await flush?.();
    if (requireFlushed && hasPendingOps?.()) {
      throw new Error("Unsaved changes can't be saved yet — fix them first.");
    }
    const id = getId();
    if (!id) throw new Error(missingIdError);
    return id;
  };

  const duplicateMutation = useDuplicateEntity({
    mutationKey: [entity, currentId ?? "__draft__", "duplicate"],
    mutationFn: async () => {
      if (!duplicate) throw new Error("Duplicate is not configured.");
      return duplicate.run(await resolveId({ requireFlushed: true }));
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
