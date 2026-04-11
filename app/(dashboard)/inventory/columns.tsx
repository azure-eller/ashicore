"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
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
import type { ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

export function getColumns(itemType: ItemType): ColumnDef<ItemRow>[] {
  const isProduct = itemType === "product";

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
        const { isMaster, parentId, variantCount, variantAttrs } = row.original;
        const isVariant = parentId != null;
        const isLow = !isMaster && calcStock(row.original) < 0;

        if (row.depth > 0) {
          // Variant sub-row: show only attr values (master name visible above)
          const attrValues: string = variantAttrs
            ? Object.values(variantAttrs).join(" / ")
            : (row.getValue("name") as string);
          return (
            <div className="pl-6 text-sm text-muted-foreground">{attrValues}</div>
          );
        }

        return (
          <div className={`flex items-center gap-1.5 ${isVariant ? "pl-7" : ""}`}>
            {isMaster && (
              <button
                onClick={() => row.toggleExpanded()}
                aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
                className="p-0.5 text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={row.getIsExpanded() ? ArrowDown01Icon : ArrowRight01Icon}
                  className="h-4 w-4"
                />
              </button>
            )}
            {isLow && (
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
            )}
            <Link
              href={`/inventory/${ITEM_TYPE_SEGMENTS[row.original.itemType]}/${row.original.id}`}
              className="hover:underline"
            >
              {row.getValue("name")}
            </Link>
            {isMaster && variantCount > 0 && (
              <Badge variant="outline" className="text-xs">
                {variantCount} variant{variantCount !== 1 ? "s" : ""}
              </Badge>
            )}
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
    // Potential column: only shown for products — how many units could be made from current ingredient stock
    ...(isProduct
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
