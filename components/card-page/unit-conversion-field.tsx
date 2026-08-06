"use client";

import { CardField } from "@/components/card-page/card-field";
import { CommitInput } from "@/components/card-page/commit-input";
import { formatQuantity } from "@/lib/format";

export function UnitConversionField({
  sourceUnitLabel,
  stockingUnitName,
  value,
  onCommit,
  disabled,
  invalid,
  error,
}: {
  sourceUnitLabel: string;
  stockingUnitName: string;
  value: string | null;
  onCommit: (value: string | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  error?: string | null;
}) {
  return (
    <CardField
      label="Unit conversion rate"
      invalid={invalid}
      error={error}
    >
      <div className="flex items-center gap-(--space-2)">
        <span className="text-[length:var(--text-sm)] text-muted-foreground">
          1 {sourceUnitLabel} =
        </span>
        <CommitInput
          label="Unit conversion rate"
          value={value}
          inputMode="decimal"
          className="max-w-[8rem]"
          disabled={disabled}
          required
          onCommit={onCommit}
        />
        <span className="text-[length:var(--text-sm)] text-muted-foreground">
          {stockingUnitName || "stock units"}
        </span>
      </div>
      {value ? (
        <p className="mt-(--space-1) text-[length:var(--text-sm)] text-muted-foreground">
          Current: 1 {sourceUnitLabel} = {formatQuantity(value)}{" "}
          {stockingUnitName}
        </p>
      ) : null}
    </CardField>
  );
}
