"use client";

import { Column, ColumnDef } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreVerticalCircle01Icon,
  Sorting01Icon,
  SortingDownIcon,
  SortingUpIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ItemRow } from "./types";

function SortIcon({ column }: { column: Column<ItemRow> }) {
  const sorted = column.getIsSorted();
  const icon =
    sorted === "asc"
      ? SortingUpIcon
      : sorted === "desc"
        ? SortingDownIcon
        : Sorting01Icon;
  return <HugeiconsIcon icon={icon} className="ml-2 h-4 w-4" />;
}

// Extend TanStack Table meta to carry the delete handler
declare module "@tanstack/react-table" {
  interface TableMeta<TData> {
    deleteRow?: (id: string) => void;
  }
}

export const columns: ColumnDef<ItemRow>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Name
        <SortIcon column={column} />
      </Button>
    ),
  },
  {
    accessorKey: "sku",
    header: "SKU",
    cell: ({ row }) => (row.getValue("sku") as string | null) ?? "—",
  },
  {
    accessorKey: "itemType",
    header: "Type",
  },
  {
    accessorKey: "inStock",
    sortingFn: (rowA, rowB) =>
      parseFloat(rowA.getValue("inStock")) - parseFloat(rowB.getValue("inStock")),
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        In Stock
        <SortIcon column={column} />
      </Button>
    ),
  },
  {
    accessorKey: "unit",
    header: "Unit",
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => (row.getValue("category") as string | null) ?? "—",
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const item = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <HugeiconsIcon icon={MoreVerticalCircle01Icon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => console.log("Edit", item.id)}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => table.options.meta?.deleteRow?.(item.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
