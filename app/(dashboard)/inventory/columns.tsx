"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { SortableHeader } from "@/components/sortable-header";
import { calcStock } from "./types";
import type { ItemRow } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

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
      const isLow = calcStock(row.original) < 0;
      return (
        <Link
          href={`/inventory/${ITEM_TYPE_SEGMENTS[row.original.itemType]}/${row.original.id}`}
          className="inline-flex items-center gap-1.5 hover:underline"
        >
          {isLow && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-destructive"
              aria-label="Below safety stock"
            />
          )}
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
    accessorKey: "stock",
    sortingFn: (rowA, rowB) =>
      parseFloat(rowA.getValue("stock")) - parseFloat(rowB.getValue("stock")),
    header: ({ column }) => <SortableHeader column={column} label="Stock" />,
    cell: ({ row }) => parseFloat(row.getValue("stock")),
  },
  {
    id: "calculatedStock",
    sortingFn: (rowA, rowB) => calcStock(rowA.original) - calcStock(rowB.original),
    header: ({ column }) => (
      <SortableHeader column={column} label="Calculated Stock" />
    ),
    cell: ({ row }) => {
      const value = calcStock(row.original);
      return (
        <span className={value < 0 ? "text-destructive" : undefined}>
          {value}
        </span>
      );
    },
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
