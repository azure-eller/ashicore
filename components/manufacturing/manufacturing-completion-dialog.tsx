"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  completeManufacturingOrder,
  recordManufacturingOutput,
  fetchManufacturingOrder,
  ManufacturingOrderApiError,
  type OutputDisposition,
} from "@/lib/api/clients/manufacturing-orders";
import { largestGroupSize } from "@/lib/manufacturing/group-size";
import type {
  ManufacturingOrderDetail,
  ManufacturingReleaseWarningPayload,
} from "@/app/(dashboard)/manufacturing/types";
import { formatQuantity } from "@/lib/format";

export type CompletionMode = "complete" | "output";

/**
 * Dialog behind the status dropdown's "Done" (complete) and "Partially complete"
 * (output) transitions, usable from the order header and from list rows: it fetches the
 * full order detail by id so it has the ingredients (group size) and planned quantity.
 */
export function ManufacturingCompletionDialog({
  orderId,
  mode,
  onClose,
  onDone,
}: {
  orderId: string;
  mode: CompletionMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["manufacturing-order", orderId],
    queryFn: () => fetchManufacturingOrder(orderId),
  });

  if (!detailQuery.data) {
    return (
      <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "complete" ? "Complete order" : "Partially complete"}</DialogTitle>
            <DialogDescription>
              {detailQuery.isError ? "Failed to load the order." : "Loading order…"}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <CompletionDialogForm order={detailQuery.data} mode={mode} onClose={onClose} onDone={onDone} />
  );
}

function CompletionDialogForm({
  order,
  mode,
  onClose,
  onDone,
}: {
  order: ManufacturingOrderDetail;
  mode: CompletionMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const groupSize = largestGroupSize(order);
  const unitName = order.unitName;

  const plannedNumber = Number(order.plannedQuantity) || 0;
  const defaultQuantity =
    mode === "complete" ? order.plannedQuantity : groupSize ? "" : "0";
  const defaultGroups =
    groupSize && mode === "complete" && plannedNumber > 0
      ? String(Math.round(plannedNumber / groupSize))
      : "";

  const [groups, setGroups] = useState(defaultGroups);
  const [rawQuantity, setRawQuantity] = useState(defaultQuantity);
  const [disposition, setDisposition] = useState<OutputDisposition>("available");
  const [shortage, setShortage] = useState<ManufacturingReleaseWarningPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quantity = useMemo(() => {
    if (groupSize) {
      const count = Number(groups);
      if (!Number.isFinite(count) || count <= 0) return "0";
      return String(count * groupSize);
    }
    return rawQuantity.trim();
  }, [groupSize, groups, rawQuantity]);

  const quantityNumber = Number(quantity);
  const quantityValid = Number.isFinite(quantityNumber) && quantityNumber > 0;

  const submit = useMutation({
    mutationFn: (confirmNegativeStock: boolean) =>
      mode === "complete"
        ? completeManufacturingOrder(order.id, {
            actualQuantity: quantity,
            outputDisposition: disposition,
            confirmNegativeStock,
          })
        : recordManufacturingOutput(order.id, {
            quantity,
            outputDisposition: disposition,
            confirmNegativeStock,
          }),
    onSuccess: () => onDone(),
    onError: (err) => {
      if (err instanceof ManufacturingOrderApiError && err.status === 409 && err.shortage) {
        setShortage(err.shortage);
        setError(null);
        return;
      }
      setShortage(null);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    },
  });

  const title = mode === "complete" ? "Complete order" : "Partially complete";
  const confirmLabel = shortage
    ? mode === "complete"
      ? "Complete anyway"
      : "Record anyway"
    : mode === "complete"
      ? "Complete"
      : "Record output";

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title} — {order.orderNumber}
          </DialogTitle>
          <DialogDescription>
            {mode === "complete"
              ? "This will pick all materials and produce the output, then close the order."
              : "Record completed output. The order stays open for the remaining quantity."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {groupSize ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="mo-groups">
                How many groups of {formatQuantity(String(groupSize))} did you complete?
              </label>
              <Input
                id="mo-groups"
                inputMode="numeric"
                value={groups}
                onChange={(event) => setGroups(event.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                = {quantityValid ? formatQuantity(quantity) : "0"} {unitName} output
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="mo-quantity">
                Completed quantity ({unitName})
              </label>
              <Input
                id="mo-quantity"
                inputMode="decimal"
                value={rawQuantity}
                onChange={(event) => setRawQuantity(event.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="mo-disposition">
              Output disposition
            </label>
            <Select
              value={disposition}
              onValueChange={(value) => setDisposition(value as OutputDisposition)}
            >
              <SelectTrigger id="mo-disposition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {shortage ? (
            <div className="space-y-2 border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3">
              <p className="text-sm font-medium text-[var(--color-warning)]">
                This will drive stock negative:
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {shortage.ingredients.map((ingredient) => (
                  <li key={ingredient.itemId}>
                    {ingredient.itemName}: short {formatQuantity(String(ingredient.shortage))}{" "}
                    {ingredient.unitName} (need {formatQuantity(String(ingredient.needed))}, have{" "}
                    {formatQuantity(String(ingredient.available))})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => submit.mutate(shortage != null)}
            disabled={submit.isPending || !quantityValid}
          >
            {submit.isPending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
