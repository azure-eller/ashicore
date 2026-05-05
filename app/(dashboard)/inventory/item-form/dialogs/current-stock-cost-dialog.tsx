"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type CurrentStockCostDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  error: string | null;
  isPending: boolean;
  onConfirm: () => void;
};

export function CurrentStockCostDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  error,
  isPending,
  onConfirm,
}: CurrentStockCostDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>Override Current Stock Unit Cost</DialogTitle>
          <DialogDescription>
            This writes a new stock-unit cost directly to the material. Purchase
            price and unit conversion stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="override-current-stock-unit-cost">
              Current Stock Unit Cost
            </FieldLabel>
            <Input
              id="override-current-stock-unit-cost"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
            />
            <FieldDescription>
              Updated automatically from opening stock and purchase receipts.
            </FieldDescription>
          </Field>
        </FieldGroup>
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isPending || !value.trim()}
          >
            {isPending ? "Updating..." : "Confirm Override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
