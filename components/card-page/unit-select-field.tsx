"use client";

import { useMemo, useState } from "react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CardSelectField,
  CardTextField,
} from "@/components/card-page/card-field";
import { apiJson } from "@/lib/client/api";
import { getUomOptions } from "@/lib/units-of-measure";

const CREATE_UNIT_VALUE = "__create_unit__";

export type UnitSelectOption = {
  id: string;
  name: string;
  size: string;
  uom: string;
};

type UnitPayload = {
  name: string;
  size: string;
  uom: string;
};

type UnitSelectFieldProps = {
  label?: string;
  currentUnitId: string;
  unitOptions: UnitSelectOption[];
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  canCreateUnit?: boolean;
  onUnitCreated?: (unit: UnitSelectOption) => void;
  onUnitChange: (unit: UnitSelectOption) => void;
};

export function UnitSelectField({
  label = "Unit of measure",
  currentUnitId,
  unitOptions,
  disabled,
  required,
  invalid,
  canCreateUnit = false,
  onUnitCreated,
  onUnitChange,
}: UnitSelectFieldProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<UnitPayload>({
    name: "",
    size: "1",
    uom: "pcs",
  });
  const uomOptions = useMemo(
    () => getUomOptions().flatMap((group) => group.options),
    [],
  );
  const createMutation = useMutation({
    mutationFn: (payload: UnitPayload) =>
      apiJson<UnitSelectOption>("/api/units", {
        method: "POST",
        body: payload,
        fallbackError: "Failed to create unit.",
      }),
    onSuccess: (unit) => {
      setDialogOpen(false);
      setDraft({ name: "", size: "1", uom: "pcs" });
      onUnitCreated?.(unit);
      onUnitChange(unit);
    },
  });

  const options = [
    ...unitOptions.map((unit) => ({
      value: unit.id,
      label: `${unit.name} (${unit.size} ${unit.uom})`,
    })),
    ...(canCreateUnit
      ? [
          {
            value: CREATE_UNIT_VALUE,
            label: (
              <>
                <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                Create unit
              </>
            ),
          },
        ]
      : []),
  ];
  const trimmedName = draft.name.trim();
  const trimmedSize = draft.size.trim();
  const canSubmit = Boolean(trimmedName && trimmedSize && draft.uom);
  const actionError =
    createMutation.error instanceof Error ? createMutation.error.message : null;

  return (
    <>
      <CardSelectField
        label={label}
        value={currentUnitId}
        onValueChange={(value) => {
          if (disabled) return;
          if (value === CREATE_UNIT_VALUE) {
            setDialogOpen(true);
            return;
          }
          const unit = unitOptions.find((option) => option.id === value);
          if (!unit || unit.id === currentUnitId) return;
          onUnitChange(unit);
        }}
        disabled={disabled}
        required={required}
        invalid={invalid}
        placeholder={canCreateUnit ? "Select or create unit" : "Select a unit"}
        options={options}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create unit</DialogTitle>
            <DialogDescription>
              Add a stocking unit for item quantities and inventory balances.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-(--space-5)">
            <CardTextField
              label="Unit name"
              value={draft.name}
              required
              controlStyle="dialog"
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Case, tray, bottle"
            />
            <CardTextField
              label="Size"
              value={draft.size}
              required
              controlStyle="dialog"
              inputMode="decimal"
              onChange={(event) =>
                setDraft((current) => ({ ...current, size: event.target.value }))
              }
            />
            <CardSelectField
              label="UOM"
              value={draft.uom}
              required
              controlStyle="dialog"
              onValueChange={(uom) => setDraft((current) => ({ ...current, uom }))}
              options={uomOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            {actionError ? (
              <p className="text-[length:var(--text-sm)] text-[var(--color-danger)]">
                {actionError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSubmit || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  name: trimmedName,
                  size: trimmedSize,
                  uom: draft.uom,
                })
              }
            >
              <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
              {createMutation.isPending ? "Creating..." : "Create unit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
