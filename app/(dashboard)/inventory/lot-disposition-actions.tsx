"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import type { InventoryDisposition } from "@/lib/db/schema";
import { apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatInventoryDisposition } from "@/lib/format";

type DispositionAction = "release" | "block" | "reject" | "scrap";

const ACTIONS: Array<{
  action: DispositionAction;
  label: string;
  toDisposition: InventoryDisposition | null;
}> = [
  { action: "release", label: "Release", toDisposition: "available" },
  { action: "block", label: "Block", toDisposition: "blocked" },
  { action: "reject", label: "Reject", toDisposition: "rejected" },
  { action: "scrap", label: "Scrap", toDisposition: null },
];

export function LotDispositionActions({
  itemId,
  lotId,
  balances,
}: {
  itemId: string;
  lotId: string;
  balances: Array<{
    disposition: InventoryDisposition;
    quantity: string;
  }>;
}) {
  const router = useRouter();
  const [selectedAction, setSelectedAction] = useState<{
    action: (typeof ACTIONS)[number];
    fromDisposition: InventoryDisposition;
    maxQuantity: string;
  } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const menuActions = balances
    .filter((balance) => Number(balance.quantity) > 0)
    .flatMap((balance) =>
      ACTIONS.filter(
        (action) =>
          action.toDisposition == null ||
          action.toDisposition !== balance.disposition,
      ).map((action) => ({
        action,
        fromDisposition: balance.disposition,
        maxQuantity: balance.quantity,
      })),
    );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedAction || !idempotencyKey) {
        throw new Error("Choose a disposition action.");
      }
      await apiJson<void>(`/api/items/${itemId}/lots/${lotId}/disposition`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: {
          action: selectedAction.action.action,
          fromDisposition: selectedAction.fromDisposition,
          quantity,
          notes: notes || null,
        },
        fallbackError: "Failed to update disposition.",
      });
    },
    onMutate: () => {
      setError(null);
    },
    onSuccess: () => {
      setSelectedAction(null);
      setIdempotencyKey(null);
      setNotes("");
      router.refresh();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const openAction = (selection: NonNullable<typeof selectedAction>) => {
    setSelectedAction(selection);
    setIdempotencyKey(`lot-disposition:${crypto.randomUUID()}`);
    setQuantity(selection.maxQuantity);
    setNotes("");
    setError(null);
  };

  const closeAction = () => {
    setSelectedAction(null);
    setIdempotencyKey(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Lot actions"
            disabled={menuActions.length === 0}
          >
            <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-[var(--color-surface)] text-[var(--color-ink)]">
          {menuActions.map((selection) => (
            <DropdownMenuItem
              key={`${selection.fromDisposition}-${selection.action.action}`}
              variant={selection.action.action === "scrap" ? "destructive" : "default"}
              onSelect={() => openAction(selection)}
            >
              {selection.action.label}
              {balances.length > 1 ? (
                <span className="ml-auto text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                  {formatInventoryDisposition(selection.fromDisposition)}
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={selectedAction != null}
        onOpenChange={(open) => {
          if (mutation.isPending) return;
          if (!open) closeAction();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedAction?.action.label ?? "Update Disposition"}
            </DialogTitle>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="disposition-quantity">Quantity</FieldLabel>
              <Input
                id="disposition-quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="disposition-notes">Notes</FieldLabel>
              <Textarea
                id="disposition-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeAction}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || selectedAction == null}
              variant={
                selectedAction?.action.action === "scrap" ? "destructive" : "default"
              }
            >
              {mutation.isPending ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
