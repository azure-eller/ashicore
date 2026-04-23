"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
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
import { DetailPageActions } from "@/components/detail-page-actions";
import { ITEM_TYPE_SEGMENTS, type ItemType } from "./types";

type Props = {
  itemId: string;
  itemType: ItemType;
  canEdit: boolean;
  canDelete: boolean;
};

export function ItemDetailActions({ itemId, itemType, canEdit, canDelete }: Props) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const basePath = `/inventory/${ITEM_TYPE_SEGMENTS[itemType]}`;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/items", {
        method: "DELETE",
        headers: createIdempotencyHeaders(`item-delete-${itemId}`, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ ids: [itemId] }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete item.");
      }
    },
    onSuccess: () => {
      setConfirmOpen(false);
      router.push(basePath);
      router.refresh();
    },
    onError: (error) => {
      setDeleteError(error.message);
    },
  });

  return (
    <>
      <DetailPageActions
        editHref={canEdit ? `${basePath}/${itemId}/edit` : undefined}
        menu={
          canDelete
            ? [
                {
                  label: "Delete",
                  onSelect: () => {
                    setDeleteError(null);
                    setConfirmOpen(true);
                  },
                  destructive: true,
                },
              ]
            : []
        }
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              The item will be soft-deleted and hidden from inventory lists. It stays
              referenced by historical orders.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive">{deleteError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
