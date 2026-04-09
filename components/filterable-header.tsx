import { type Column, type FilterFn } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Multi-select column filter using DropdownMenuCheckboxItem.
 * Use with `filterFn: multiValueFilter` on the column definition.
 * Options are derived automatically via getFacetedUniqueValues().
 */
export function FilterableHeader<T>({
  column,
  label,
}: {
  column: Column<T>;
  label: string;
}) {
  const selected = (column.getFilterValue() as string[] | undefined) ?? [];
  const faceted = column.getFacetedUniqueValues();

  const options = Array.from(faceted.keys())
    .filter((v): v is string => v != null && v !== "")
    .sort();

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    column.setFilterValue(next.length > 0 ? next : undefined);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="-ml-3"
          aria-label={`Filter by ${label}${selected.length > 0 ? `, ${selected.length} selected` : ""}`}
        >
          {label}
          {selected.length > 0 && (
            <span className="ml-1.5 flex h-4 items-center rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {selected.length}
            </span>
          )}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="ml-1 h-3.5 w-3.5"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-popover text-popover-foreground">
        {options.map((value) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={selected.includes(value)}
            onCheckedChange={() => toggle(value)}
            onSelect={(e) => e.preventDefault()}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
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
    </DropdownMenu>
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
