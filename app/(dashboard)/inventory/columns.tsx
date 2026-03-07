"use client";

import { ColumnDef } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { SortByDown02Icon, SortByUp02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ItemRow } from "./types";

export const columns: ColumnDef<ItemRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Name
        <HugeiconsIcon
          icon={column.getIsSorted() === "asc" ? SortByUp02Icon : SortByDown02Icon}
          className="ml-2 h-4 w-4"
        />
      </Button>
    ),
  },
  {
    accessorKey: "sku",
    header: "SKU",
    cell: ({ row }) => (row.getValue("sku") as string | null) ?? "—",
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
        <HugeiconsIcon
          icon={column.getIsSorted() === "asc" ? SortByUp02Icon : SortByDown02Icon}
          className="ml-2 h-4 w-4"
        />
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
];
