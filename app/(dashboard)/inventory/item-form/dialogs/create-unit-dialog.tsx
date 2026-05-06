"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UomGroup = {
  category: string;
  options: Array<{ value: string; label: string }>;
};

type CreateUnitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  size: string;
  onSizeChange: (value: string) => void;
  uom: string;
  onUomChange: (value: string) => void;
  uomGroups: UomGroup[];
  sizeInvalid: boolean;
  error: string | null;
  isPending: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
};

export function CreateUnitDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  size,
  onSizeChange,
  uom,
  onUomChange,
  uomGroups,
  sizeInvalid,
  error,
  isPending,
  canSubmit,
  onSubmit,
}: CreateUnitDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Create Unit</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="unit-name">Name</FieldLabel>
            <Input
              id="unit-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="e.g. bag"
              autoComplete="off"
            />
          </Field>
          <Field data-invalid={sizeInvalid}>
            <FieldLabel htmlFor="unit-size">Size</FieldLabel>
            <Input
              id="unit-size"
              value={size}
              onChange={(event) => onSizeChange(event.target.value)}
              placeholder="e.g. 1"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={sizeInvalid}
            />
            {sizeInvalid && <FieldError>Must be a positive number</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="unit-uom">Unit of Measure</FieldLabel>
            <Select value={uom} onValueChange={onUomChange}>
              <SelectTrigger id="unit-uom" className="w-full">
                <SelectValue placeholder="Select a unit of measure" />
              </SelectTrigger>
              <SelectContent>
                {uomGroups.map((group) => (
                  <SelectGroup key={group.category}>
                    <SelectLabel>{group.category}</SelectLabel>
                    {group.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={onSubmit} disabled={!canSubmit}>
            {isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
