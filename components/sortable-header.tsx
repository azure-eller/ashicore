import { type Column } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SortByDown02Icon,
  SortByUp02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";

export function SortableHeader<T>({
  column,
  label,
}: {
  column: Column<T>;
  label: string;
}) {
  const sorted = column.getIsSorted();
  const icon = sorted === "asc" ? SortByUp02Icon : SortByDown02Icon;

  return (
    <Button
      variant="ghost"
      className="-ml-3"
      onClick={() => column.toggleSorting(sorted === "asc")}
      aria-label={`Sort by ${label}${sorted === "asc" ? ", sorted ascending" : sorted === "desc" ? ", sorted descending" : ""}`}
    >
      {label}
      <HugeiconsIcon icon={icon} className="ml-2 h-4 w-4" aria-hidden />
    </Button>
  );
}
