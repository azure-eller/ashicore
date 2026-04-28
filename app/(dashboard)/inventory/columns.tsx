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
import { CALCULATED_STOCK_ALERT_TOOLTIP } from "@/lib/tooltip-copy";
import { formatQuantity } from "@/lib/format";
import { calcStock } from "./types";
import type { InventoryProductView, ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

type InventoryStatus = {
  label: string;
  rank: number;
  variant: "destructive" | "warning" | "outline" | "secondary";
};

function getInventoryStatus(row: ItemRow): InventoryStatus {
  const demand = parseFloat(row.demandQty);
  const reserved = parseFloat(row.committedQty);
  const shortage = parseFloat(row.shortageQty);
  const calculatedStock = calcStock(row);

  if (shortage > 0) {
    return {
      label: "Backordered",
      rank: 0,
      variant: "destructive",
    };
  }

  if (calculatedStock < 0) {
    return {
      label: "Below safety",
      rank: 1,
      variant: "warning",
    };
  }

  if (demand > 0 && reserved > 0 && reserved < demand) {
    return {
      label: "Partially reserved",
      rank: 2,
      variant: "outline",
    };
  }

  if (demand > 0) {
    return {
      label: "Reserved",
      rank: 3,
      variant: "secondary",
    };
  }

  return {
    label: "OK",
    rank: 4,
    variant: "secondary",
  };
}

function InventoryStatusBadge({ row }: { row: ItemRow }) {
  const status = getInventoryStatus(row);

  return (
    <Badge variant={status.variant} className="text-xs">
      {status.label}
    </Badge>
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
        const status = getInventoryStatus(row.original);
        const showAttentionIndicator = !isMaster && status.rank <= 1;

        if (row.depth > 0 && !isSubAssemblies) {
          const attrValues = variantAttrs
            ? Object.values(variantAttrs).join(" / ")
            : row.original.displayName;

          return (
            <Link
              href={`/inventory/${ITEM_TYPE_SEGMENTS[row.original.itemType]}/${row.original.id}`}
              prefetch={false}
              className="block pl-6 text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              {attrValues}
            </Link>
          );
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
            {showAttentionIndicator ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="size-2 shrink-0 cursor-default rounded-full bg-destructive"
                    aria-label={status.label}
                  />
                </TooltipTrigger>
                <TooltipContent side="top">
                  {status.label === "Backordered"
                    ? "Accepted demand is not fully reserved."
                    : CALCULATED_STOCK_ALERT_TOOLTIP}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Link
              href={`/inventory/${ITEM_TYPE_SEGMENTS[row.original.itemType]}/${row.original.id}`}
              prefetch={false}
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
        if (!value) return "—";

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
      accessorKey: "availableQty",
      sortDescFirst: false,
      sortingFn: (rowA, rowB) =>
        parseFloat(rowA.getValue("availableQty")) -
        parseFloat(rowB.getValue("availableQty")),
      header: ({ column }) => <SortableHeader column={column} label="Available" />,
      cell: ({ row }) => formatQuantity(row.getValue("availableQty")),
    },
    {
      id: "status",
      accessorFn: (row) => getInventoryStatus(row).rank,
      sortDescFirst: false,
      sortingFn: (rowA, rowB) =>
        getInventoryStatus(rowA.original).rank - getInventoryStatus(rowB.original).rank,
      header: ({ column }) => <SortableHeader column={column} label="Status" />,
      cell: ({ row }) => <InventoryStatusBadge row={row.original} />,
    },
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
              if (val == null) return "—";
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
      cell: ({ row }) => row.original.unit ?? "—",
    },
    {
      accessorKey: "sku",
      header: "SKU",
      cell: ({ row }) => {
        if (row.original.isMaster) return "—";
        return (row.getValue("sku") as string | null) ?? "—";
      },
    },
  ];
}
