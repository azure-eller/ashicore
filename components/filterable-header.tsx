"use client";

import { type ComponentProps, useState } from "react";
import { type Column, type FilterFn } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type FilterOption = {
  value: string;
  label: string;
};

type FilterHeaderButtonProps = ComponentProps<typeof Button> & {
  label: string;
  selectedCount: number;
};

export function FilterHeaderButton({
  className,
  label,
  selectedCount,
  ...props
}: FilterHeaderButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn("-ml-3", className)}
      aria-label={`Filter by ${label}${selectedCount > 0 ? `, ${selectedCount} selected` : ""}`}
      {...props}
    >
      {label}
      {selectedCount > 0 && (
        <span className="ml-(--space-3) flex h-(--space-8) items-center bg-primary px-(--space-2) font-mono text-[length:var(--text-2xs)] font-medium tabular-nums text-primary-foreground">
          {selectedCount}
        </span>
      )}
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        className="ml-1 h-3.5 w-3.5"
        aria-hidden
      />
    </Button>
  );
}

/**
 * Multi-select column filter using DropdownMenuCheckboxItem.
 * Use with `filterFn: multiValueFilter` on the column definition.
 * Options are derived automatically via getFacetedUniqueValues().
 */
export function FilterableHeader<T>({
  column,
  label,
  tooltip,
  options,
}: {
  column: Column<T>;
  label: string;
  tooltip?: string;
  options?: readonly FilterOption[];
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const selected = (column.getFilterValue() as string[] | undefined) ?? [];
  const faceted = column.getFacetedUniqueValues();

  const filterOptions =
    options ??
    Array.from(faceted.keys())
      .filter((v): v is string => v != null && v !== "")
      .sort()
      .map((value) => ({
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1),
      }));

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    column.setFilterValue(next.length > 0 ? next : undefined);
  }

  function handleDropdownOpenChange(open: boolean) {
    setIsDropdownOpen(open);
    if (open) {
      setIsTooltipOpen(false);
    }
  }

  const button = (
    <FilterHeaderButton label={label} selectedCount={selected.length} />
  );

  const content = (
    <DropdownMenuContent align="start" className="bg-popover text-popover-foreground">
      {filterOptions.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.value}
          checked={selected.includes(option.value)}
          onCheckedChange={() => toggle(option.value)}
          onSelect={(e) => e.preventDefault()}
        >
          {option.label}
        </DropdownMenuCheckboxItem>
      ))}
      {selected.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={false}
            onCheckedChange={() => column.setFilterValue(undefined)}
          >
            Clear filter
          </DropdownMenuCheckboxItem>
        </>
      )}
    </DropdownMenuContent>
  );

  if (!tooltip) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        {content}
      </DropdownMenu>
    );
  }

  return (
    <Tooltip
      open={!isDropdownOpen && isTooltipOpen}
      onOpenChange={setIsTooltipOpen}
    >
      <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        </TooltipTrigger>
        {content}
      </DropdownMenu>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function ServerFilterableHeader({
  label,
  tooltip,
  options,
  value,
  defaultValue,
  onValueChange,
}: {
  label: string;
  tooltip?: string;
  options: readonly FilterOption[];
  value?: string;
  defaultValue?: string;
  onValueChange: (value: string | undefined) => void;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const selectedCount = value == null || value === defaultValue ? 0 : 1;

  function handleDropdownOpenChange(open: boolean) {
    setIsDropdownOpen(open);
    if (open) {
      setIsTooltipOpen(false);
    }
  }

  const button = <FilterHeaderButton label={label} selectedCount={selectedCount} />;

  const content = (
    <DropdownMenuContent align="start" className="bg-popover text-popover-foreground">
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.value}
          checked={value === option.value}
          onSelect={() => onValueChange(value === option.value ? undefined : option.value)}
        >
          {option.label}
        </DropdownMenuCheckboxItem>
      ))}
      {value != null && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={false}
            onSelect={() => onValueChange(undefined)}
          >
            Clear filter
          </DropdownMenuCheckboxItem>
        </>
      )}
    </DropdownMenuContent>
  );

  if (!tooltip) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        {content}
      </DropdownMenu>
    );
  }

  return (
    <Tooltip
      open={!isDropdownOpen && isTooltipOpen}
      onOpenChange={setIsTooltipOpen}
    >
      <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        </TooltipTrigger>
        {content}
      </DropdownMenu>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * TanStack Table filter function for multi-value selection.
 * filterValue is string[] — row passes if its value is in the array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const multiValueFilter: FilterFn<any> = (row, columnId, filterValue: string[]) => {
  return filterValue.includes(row.getValue(columnId));
};
