"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import type { InventoryDisposition } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
  fromDisposition,
  maxQuantity,
}: {
  itemId: string;
  lotId: string;
  fromDisposition: InventoryDisposition;
  maxQuantity: string;
}) {
  const router = useRouter();
  const [selectedAction, setSelectedAction] =
    useState<(typeof ACTIONS)[number] | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(maxQuantity);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedAction || !idempotencyKey) {
        throw new Error("Choose a disposition action.");
      }
      const response = await fetch(
        `/api/items/${itemId}/lots/${lotId}/disposition`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("lot-disposition", {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          }),
          body: JSON.stringify({
            action: selectedAction.action,
            fromDisposition,
            quantity,
            notes: notes || null,
          }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to update disposition.");
      }
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

  const openAction = (action: (typeof ACTIONS)[number]) => {
    setSelectedAction(action);
    setIdempotencyKey(`lot-disposition:${crypto.randomUUID()}`);
    setQuantity(maxQuantity);
    setNotes("");
    setError(null);
  };

  const closeAction = () => {
    setSelectedAction(null);
    setIdempotencyKey(null);
  };

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {ACTIONS.filter(
          (action) =>
            action.toDisposition == null || action.toDisposition !== fromDisposition
        ).map((action) => (
          <Button
            key={action.action}
            type="button"
            size="sm"
            variant={action.action === "scrap" ? "destructive" : "outline"}
            onClick={() => openAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      <Dialog
        open={selectedAction != null}
        onOpenChange={(open) => {
          if (mutation.isPending) return;
          if (!open) closeAction();
        }}
      >
        <DialogContent className="bg-background text-foreground">
          <DialogHeader>
            <DialogTitle>{selectedAction?.label ?? "Update Disposition"}</DialogTitle>
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
              variant={selectedAction?.action === "scrap" ? "destructive" : "default"}
            >
              {mutation.isPending ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
