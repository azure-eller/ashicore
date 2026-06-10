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
import { NoticePanel } from "@/components/notice-panel";
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
import type {
  ManufacturingOrderDetail,
  ManufacturingReleaseWarningPayload,
} from "@/lib/manufacturing/types";
import { formatQuantity } from "@/lib/format";

export type CompletionMode = "complete" | "output";

/** The date lot the server will generate by default; used as a placeholder. */
function proposedLotNumber(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `LOT-${yyyy}-${mm}-${dd}`;
}

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
  const unitName = order.unitName;
  const completesBatchOrder = mode === "complete" && order.manufacturingMode === "batch";
  const completesPartialBatchOrder = mode === "output" && order.manufacturingMode === "batch";
  const hasRecordedOutput = Number(order.actualQuantity ?? "0") > 0;
  const remainingBatchCount = order.batches.filter((batch) => batch.status !== "completed").length;

  const defaultQuantity =
    mode === "complete" && !hasRecordedOutput && !completesBatchOrder
      ? order.plannedQuantity
      : "";
  const defaultBatchCount = completesPartialBatchOrder ? "1" : "";

  // A discrete MO is one lot; it can be named once, on the first output. Batch
  // MOs lot per batch in the execution flow, not from this all-at-once dialog.
  const showLotField =
    order.productLotTrackingMode !== "untracked" &&
    !hasRecordedOutput &&
    !completesBatchOrder &&
    !completesPartialBatchOrder;

  const [rawQuantity, setRawQuantity] = useState(defaultQuantity);
  const [rawBatchCount, setRawBatchCount] = useState(defaultBatchCount);
  const [rawLotNumber, setRawLotNumber] = useState("");
  const [disposition, setDisposition] = useState<OutputDisposition>("available");
  const [shortage, setShortage] = useState<ManufacturingReleaseWarningPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dispositionOptions: OutputDisposition[] =
    order.productLotTrackingMode === "untracked" ? ["available"] : ["available", "blocked"];

  const quantity = useMemo(() => {
    return rawQuantity.trim();
  }, [rawQuantity]);

  const quantityNumber = Number(quantity);
  const batchCount = Number(rawBatchCount);
  const batchCountValid =
    !completesPartialBatchOrder ||
    (Number.isInteger(batchCount) &&
      batchCount > 0 &&
      batchCount <= remainingBatchCount);
  const quantityRequired =
    !completesPartialBatchOrder &&
    (mode !== "complete" || (!hasRecordedOutput && !completesBatchOrder));
  const quantityValid =
    !quantityRequired || (Number.isFinite(quantityNumber) && quantityNumber > 0);

  const producedLotNumber = showLotField
    ? rawLotNumber.trim() || undefined
    : undefined;

  const submit = useMutation({
    mutationFn: (confirmNegativeStock: boolean) =>
      mode === "complete"
        ? completeManufacturingOrder(order.id, {
            actualQuantity: hasRecordedOutput || completesBatchOrder ? undefined : quantity,
            outputDisposition: disposition,
            confirmNegativeStock,
            producedLotNumber,
          })
        : completesPartialBatchOrder
          ? completeManufacturingOrder(order.id, {
              batchCount,
              outputDisposition: disposition,
              confirmNegativeStock,
            })
        : recordManufacturingOutput(order.id, {
            quantity,
            outputDisposition: disposition,
            confirmNegativeStock,
            producedLotNumber,
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
      : completesPartialBatchOrder
        ? "Complete batches"
      : "Record output";

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title} — {order.orderNumber}
          </DialogTitle>
          <DialogDescription>
            {completesBatchOrder
              ? "This will produce the remaining planned batch output, close all remaining batches, and move the order to Done."
              : completesPartialBatchOrder
                ? "Complete whole batches. The order stays open for the remaining batches."
              : mode === "complete"
                ? "This will pick all materials and produce the output, then close the order."
                : "Record completed output. The order stays open for the remaining quantity."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {completesPartialBatchOrder ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="mo-batch-count">
                Batches to complete
              </label>
              <Input
                id="mo-batch-count"
                inputMode="numeric"
                value={rawBatchCount}
                onChange={(event) => setRawBatchCount(event.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {remainingBatchCount} remaining · {order.expectedBatchYield ?? "—"} {unitName} each
              </p>
            </div>
          ) : hasRecordedOutput && mode === "complete" && !completesBatchOrder ? (
            <p className="text-sm text-muted-foreground">
              {formatQuantity(order.actualQuantity ?? "0")} {unitName} has already been
              recorded. Completing closes the order without producing another lot.
            </p>
          ) : completesBatchOrder ? (
            <p className="text-sm text-muted-foreground">
              Remaining batches will be completed at their planned quantities.
            </p>
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

          {showLotField ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="mo-lot-number">
                Lot number
              </label>
              <Input
                id="mo-lot-number"
                value={rawLotNumber}
                onChange={(event) => setRawLotNumber(event.target.value)}
                placeholder={proposedLotNumber(new Date())}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use {proposedLotNumber(new Date())}.
              </p>
            </div>
          ) : null}

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
                {dispositionOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "available" ? "Available" : "Blocked"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {shortage ? (
            <NoticePanel className="space-y-2">
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
            </NoticePanel>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => submit.mutate(shortage != null)}
            disabled={submit.isPending || !quantityValid || !batchCountValid}
          >
            {submit.isPending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
