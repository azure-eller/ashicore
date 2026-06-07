"use client";

import { useState, type ReactNode } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type AlertDialogSize = "sm" | "default" | "lg" | "xl" | "2xl" | "3xl";

export function useConfirmMutation<TVariables = void>({
  title,
  description,
  confirmLabel = "Confirm",
  pendingLabel,
  cancelLabel = "Cancel",
  size = "sm",
  mutation,
}: {
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: ReactNode;
  pendingLabel?: ReactNode;
  cancelLabel?: ReactNode;
  size?: AlertDialogSize;
  mutation: UseMutationResult<unknown, Error, TVariables>;
}) {
  const [request, setRequest] = useState<{ variables: TVariables } | null>(null);
  const open = request != null;

  const close = () => {
    mutation.reset();
    setRequest(null);
  };

  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
            {mutation.error ? (
              <span className="mt-(--space-2) block text-[var(--status-danger-ink)]">
                {mutation.error.message}
              </span>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            onClick={(event) => {
              event.preventDefault();
              if (request == null) return;
              mutation.mutate(request.variables, {
                onSuccess: () => setRequest(null),
              });
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    trigger: (nextVariables?: TVariables) =>
      setRequest({ variables: nextVariables as TVariables }),
    dialog,
    mutation,
  };
}
