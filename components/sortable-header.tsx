import { type Column } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SortByDown02Icon,
  SortByUp02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SortableHeader<T>({
  column,
  label,
  tooltip,
}: {
  column: Column<T>;
  label: string;
  tooltip?: string;
}) {
  const sorted = column.getIsSorted();
  const icon = sorted === "asc" ? SortByUp02Icon : SortByDown02Icon;

  const button = (
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

  if (!tooltip) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
