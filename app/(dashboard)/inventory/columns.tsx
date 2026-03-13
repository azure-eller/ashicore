"use client";

import { ColumnDef, Column } from "@tanstack/react-table";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { SortByDown02Icon, SortByUp02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ItemRow } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

function SortableHeader({ column, label }: { column: Column<ItemRow>; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(sorted === "asc")}
      aria-label={`Sort by ${label}${sorted === "asc" ? ", sorted ascending" : sorted === "desc" ? ", sorted descending" : ""}`}
    >
      {label}
      {sorted && (
        <HugeiconsIcon
          icon={sorted === "asc" ? SortByUp02Icon : SortByDown02Icon}
          className="ml-2 h-4 w-4"
          aria-hidden
        />
      )}
    </Button>
  );
}

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
        aria-label={`Select ${row.getValue("name")}`}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} label="Name" />,
    cell: ({ row }) => {
      // TODO: /inventory/products/[id] does not exist yet — will 404 for product rows
      return (
        <Link
          href={`/inventory/${ITEM_TYPE_SEGMENTS[row.original.itemType]}/${row.original.id}`}
          className="hover:underline"
        >
          {row.getValue("name")}
        </Link>
      );
    },
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
    header: ({ column }) => <SortableHeader column={column} label="In Stock" />,
    cell: ({ row }) => parseFloat(row.getValue("inStock")),
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
