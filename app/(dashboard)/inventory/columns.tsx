"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { SortableHeader } from "@/components/sortable-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CALCULATED_STOCK_ALERT_TOOLTIP,
  CALCULATED_STOCK_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatQuantity } from "@/lib/format";
import { calcStock } from "./types";
import type { InventoryProductView, ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

type UsedInResponse = {
  parents: Array<{
    id: string;
    name: string;
    displayName: string;
  }>;
};

function UsedInPopover({
  itemId,
  usedInCount,
  isMaster,
}: {
  itemId: string;
  usedInCount: number;
  isMaster: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<UsedInResponse>({
    queryKey: ["items", itemId, "used-in"],
    queryFn: async () => {
      const response = await fetch(`/api/items/${itemId}/used-in`);
      if (!response.ok) {
        throw new Error("Failed to fetch parent products");
      }

      return response.json();
    },
    enabled: open && usedInCount > 0 && !isMaster,
  });

  if (isMaster) {
    return "\u2014";
  }

  if (usedInCount === 0) {
    return <span className="text-muted-foreground">0</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer text-left font-medium text-foreground underline decoration-dotted underline-offset-4 hover:text-primary"
        >
          {usedInCount}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 bg-popover text-popover-foreground"
      >
        <PopoverHeader>
          <PopoverTitle>Used In</PopoverTitle>
          <PopoverDescription>
            Products that currently consume this item in their recipe.
          </PopoverDescription>
        </PopoverHeader>
        <div className="mt-3 flex flex-col gap-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading parent products…</p>
          ) : (
            data?.parents.map((parent) => (
              <Link
                key={parent.id}
                href={`/inventory/products/${parent.id}`}
                className="text-sm font-medium hover:underline"
              >
                {parent.displayName}
              </Link>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function getColumns(
  itemType: ItemType,
  view?: InventoryProductView,
): ColumnDef<ItemRow>[] {
  const isProduct = itemType === "product";
  const isSubAssemblies = view === "sub-assemblies";

  return [
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
          aria-label={`Select ${row.original.displayName}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "displayName",
      header: ({ column }) => <SortableHeader column={column} label="Name" />,
      cell: ({ row }) => {
        const { isMaster, parentId, variantCount, variantAttrs, sellable } = row.original;
        const isVariant = parentId != null;
        const isLow = !isMaster && calcStock(row.original) < 0;

        if (row.depth > 0 && !isSubAssemblies) {
          const attrValues = variantAttrs
            ? Object.values(variantAttrs).join(" / ")
            : row.original.displayName;

          return <div className="pl-6 text-sm text-muted-foreground">{attrValues}</div>;
        }

        return (
          <div className={`flex items-center gap-1.5 ${isVariant && !isSubAssemblies ? "pl-7" : ""}`}>
            {isMaster && !isSubAssemblies ? (
              <button
                type="button"
                onClick={() => row.toggleExpanded()}
                aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
                className="p-0.5 text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={row.getIsExpanded() ? ArrowDown01Icon : ArrowRight01Icon}
                  className="h-4 w-4"
                />
              </button>
            ) : null}
            {isLow ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="h-2 w-2 shrink-0 cursor-default rounded-full bg-destructive"
                    aria-label="Below safety stock"
                  />
                </TooltipTrigger>
                <TooltipContent side="top">
                  {CALCULATED_STOCK_ALERT_TOOLTIP}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Link
              href={`/inventory/${ITEM_TYPE_SEGMENTS[row.original.itemType]}/${row.original.id}`}
              className="hover:underline"
            >
              {row.original.displayName}
            </Link>
            {isMaster && variantCount > 0 ? (
              <Badge variant="outline" className="text-xs">
                {variantCount} variant{variantCount !== 1 ? "s" : ""}
              </Badge>
            ) : null}
            {isSubAssemblies && sellable === false ? (
              <Badge variant="outline" className="text-xs">
                Not sellable
              </Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: "category",
      header: ({ column }) => <FilterableHeader column={column} label="Category" />,
      filterFn: multiValueFilter,
      cell: ({ row, column }) => {
        const value = row.getValue("category") as string | null;
        if (!value) return "\u2014";

        return (
          <button
            type="button"
            className="cursor-pointer text-left"
            onClick={() => {
              const current = column.getFilterValue() as string[] | undefined;
              if (current?.length === 1 && current[0] === value) {
                column.setFilterValue(undefined);
              } else {
                column.setFilterValue([value]);
              }
            }}
          >
            {value}
          </button>
        );
      },
    },
    {
      accessorKey: "stock",
      sortDescFirst: false,
      sortingFn: (rowA, rowB) =>
        parseFloat(rowA.getValue("stock")) - parseFloat(rowB.getValue("stock")),
      header: ({ column }) => <SortableHeader column={column} label="Stock" />,
      cell: ({ row }) => formatQuantity(row.getValue("stock")),
    },
    {
      id: "calculatedStock",
      accessorFn: (row) => calcStock(row),
      sortDescFirst: false,
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Calculated Stock"
          tooltip={CALCULATED_STOCK_TOOLTIP}
        />
      ),
      cell: ({ row }) => {
        const value = row.getValue<number>("calculatedStock");
        return (
          <span className={value < 0 ? "text-destructive" : undefined}>
            {value}
          </span>
        );
      },
    },
    ...(isProduct
      ? [
          {
            id: "usedIn",
            accessorFn: (row: ItemRow) => row.usedInCount,
            header: "Used In",
            cell: ({ row }) => (
              <UsedInPopover
                itemId={row.original.id}
                usedInCount={row.original.usedInCount}
                isMaster={row.original.isMaster}
              />
            ),
          } satisfies ColumnDef<ItemRow>,
        ]
      : []),
    ...(isProduct && !isSubAssemblies
      ? [
          {
            accessorKey: "potential",
            sortDescFirst: false,
            sortingFn: (rowA, rowB) => {
              const a = rowA.original.potential != null ? parseFloat(rowA.original.potential) : -1;
              const b = rowB.original.potential != null ? parseFloat(rowB.original.potential) : -1;
              return a - b;
            },
            header: ({ column }) => (
              <SortableHeader
                column={column}
                label="Potential"
                tooltip="Units that can be produced from current available ingredient stock."
              />
            ),
            cell: ({ row }) => {
              const val = row.original.potential;
              if (val == null) return "\u2014";
              const num = parseFloat(val);
              return (
                <span className={num <= 0 ? "text-muted-foreground" : undefined}>
                  {num}
                </span>
              );
            },
          } satisfies ColumnDef<ItemRow>,
        ]
      : []),
    {
      accessorKey: "unit",
      header: "Stocking Unit",
      cell: ({ row }) => row.original.unit ?? "\u2014",
    },
    {
      accessorKey: "sku",
      header: "SKU",
      cell: ({ row }) => {
        if (row.original.isMaster) return "\u2014";
        return (row.getValue("sku") as string | null) ?? "\u2014";
      },
    },
  ];
}
