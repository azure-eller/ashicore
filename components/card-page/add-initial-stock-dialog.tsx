"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  addInitialStock,
  EndpointNotReadyError,
  type AddInitialStockInput,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";

export type AddInitialStockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: ItemCardVariantDto | null;
  /** Best-effort default location id from the org context. Until /api/locations exists, the caller passes whatever is known (or empty string). */
  defaultLocationId?: string;
  unitLabel?: string;
  /**
   * For materials: prefill cost per unit from the variant's defaultPurchasePrice
   * adjusted by the card-level purchase unit conversion. Backend cost-resolution
   * helper does the math at submit time, but we pre-fill the field for clarity.
   */
  defaultCostPerUnit?: string | null;
};

export function AddInitialStockDialog({
  open,
  onOpenChange,
  variant,
  defaultLocationId = "",
  unitLabel,
  defaultCostPerUnit,
}: AddInitialStockDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {open && variant ? (
          <DialogBody
            onOpenChange={onOpenChange}
            variant={variant}
            defaultLocationId={defaultLocationId}
            unitLabel={unitLabel}
            defaultCostPerUnit={defaultCostPerUnit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  onOpenChange,
  variant,
  defaultLocationId,
  unitLabel,
  defaultCostPerUnit,
}: {
  onOpenChange: (open: boolean) => void;
  variant: ItemCardVariantDto;
  defaultLocationId: string;
  unitLabel?: string;
  defaultCostPerUnit?: string | null;
}) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState("");
  const [costPerUnit, setCostPerUnit] = useState(defaultCostPerUnit ?? "");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [occurredAt, setOccurredAt] = useState(() => nowLocalIsoSecond());
  const [adjustmentNumber, setAdjustmentNumber] = useState("");

  const mutation = useMutation({
    mutationKey: ["item-card", variant.id, "add-stock"],
    mutationFn: (input: AddInitialStockInput) => addInitialStock(variant.id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card", variant.familyId] });
      onOpenChange(false);
    },
  });

  const errorMessage =
    mutation.error instanceof EndpointNotReadyError
      ? "Pending backend: adding stock from the card isn’t shipped yet. Use the materials/lots flow until then."
      : mutation.error
      ? (mutation.error as Error).message
      : null;

  const quantityValid = quantity.trim() !== "" && Number(quantity) > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adding initial stock</DialogTitle>
        <DialogDescription>{variant.displayName}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-(--space-4) md:grid-cols-2">
        <Field data-invalid={!quantityValid && quantity !== ""}>
          <FieldLabel>Stock quantity</FieldLabel>
          <div className="flex items-center gap-(--space-2)">
            <Input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="Type quantity"
              inputMode="decimal"
              aria-invalid={!quantityValid && quantity !== "" ? true : undefined}
            />
            {unitLabel ? (
              <span className="text-[length:var(--text-sm)] text-muted-foreground">
                {unitLabel}
              </span>
            ) : null}
          </div>
        </Field>

        <Field>
          <FieldLabel>Cost per unit</FieldLabel>
          <div className="flex items-center gap-(--space-2)">
            <Input
              value={costPerUnit}
              onChange={(event) => setCostPerUnit(event.target.value)}
              placeholder="Type cost per unit"
              inputMode="decimal"
            />
            <span className="text-[length:var(--text-sm)] text-muted-foreground">USD</span>
          </div>
        </Field>

        <Field>
          <FieldLabel>Stock adjustment number</FieldLabel>
          <Input
            value={adjustmentNumber}
            onChange={(event) => setAdjustmentNumber(event.target.value)}
            placeholder="Auto-assigned if blank"
          />
        </Field>

        <Field>
          <FieldLabel>Stock adjustment date</FieldLabel>
          <DateTimePicker value={occurredAt} onChange={setOccurredAt} />
        </Field>

        <Field className="md:col-span-2">
          <FieldLabel>Location</FieldLabel>
          <Input
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            placeholder="Pending backend — /api/locations not exposed yet"
            disabled
          />
        </Field>
      </div>

      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!quantityValid || mutation.isPending}
          onClick={() => {
            mutation.mutate({
              quantity: quantity.trim(),
              costPerUnit: costPerUnit.trim() === "" ? null : costPerUnit.trim(),
              locationId,
              occurredAt: new Date(occurredAt).toISOString(),
              adjustmentNumber:
                adjustmentNumber.trim() === "" ? null : adjustmentNumber.trim(),
            });
          }}
        >
          {mutation.isPending ? "Adding…" : "Add initial stock"}
        </Button>
      </DialogFooter>
    </>
  );
}

function nowLocalIsoSecond(): string {
  // returns YYYY-MM-DDTHH:mm:ss for DateTimePicker (local-time string)
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
