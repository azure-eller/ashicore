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
      spacing={1}
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue | "")}
      aria-label={ariaLabel}
      className="h-(--height-grid-toolbar-control) max-w-full flex-wrap gap-(--space-1) rounded-(--radius-full) bg-[var(--color-surface-sunk)] p-(--space-1)"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          className="h-full gap-(--space-3) rounded-(--radius-full) px-(--space-8) text-[length:var(--text-control)] font-semibold text-[var(--color-ink-soft)] shadow-none data-[state=on]:bg-[var(--color-surface)] data-[state=on]:text-[var(--color-ink)] data-[state=on]:shadow-[var(--shadow-sticky)]"
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
    <span className="font-mono text-[length:var(--text-xs)] font-normal tabular-nums text-[var(--color-ink-faint)] group-data-[state=on]/toggle:text-[var(--color-accent-ink)]">
      {count}
    </span>
  );
}
