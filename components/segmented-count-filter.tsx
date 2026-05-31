"use client";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

export type SegmentedCountFilterOption<TValue extends string> = {
  value: TValue;
  label: string;
  count: number;
  ariaLabel: string;
};

export function SegmentedCountFilter<TValue extends string>({
  value,
  options,
  ariaLabel,
  onValueChange,
}: {
  value: TValue | "";
  options: readonly SegmentedCountFilterOption<TValue>[];
  ariaLabel: string;
  onValueChange: (value: TValue | "") => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      size="sm"
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue | "")}
      aria-label={ariaLabel}
      className="max-w-full flex-wrap bg-muted p-(--space-1)"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          className="gap-(--space-3)"
        >
          {option.label}
          <SegmentedCountFilterCount count={option.count} />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function SegmentedCountFilterCount({ count }: { count: number }) {
  return (
    <span className="font-mono text-[length:var(--text-2xs)] tabular-nums text-muted-foreground">
      {count}
    </span>
  );
}
