"use client";

import { type ColumnDef, type FilterFn } from "@tanstack/react-table";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FilterableHeader } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AVAILABLE_QTY_TOOLTIP,
  CALCULATED_STOCK_ALERT_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  MARGIN_TOOLTIP,
  NOT_SELLABLE_TOOLTIP,
  ON_HAND_STOCK_TOOLTIP,
  POTENTIAL_TOOLTIP,
  STOCKING_UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatQuantity } from "@/lib/format";
import { calcStock } from "./types";
import type { InventoryProductView, ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

type InventoryAttention = {
  label: string;
  tooltip: string;
};

const categoryFilter: FilterFn<ItemRow> = (row, columnId, filterValue) => {
  const selected = Array.isArray(filterValue) ? filterValue : [];
  if (selected.length === 0) return true;

  const ownCategory = row.getValue(columnId) as string | null;
  if (ownCategory != null && selected.includes(ownCategory)) {
    return true;
  }

  const parentCategory = row.getParentRow()?.original.category;
  if (parentCategory != null && selected.includes(parentCategory)) {
    return true;
  }

  return row.original.subRows?.some((subRow) =>
    subRow.category != null && selected.includes(subRow.category)
  ) ?? false;
};

function getInventoryAttention(row: ItemRow): InventoryAttention | null {
  const shortage = parseFloat(row.shortageQty);
  const calculatedStock = calcStock(row);

  if (shortage > 0) {
    return {
      label: "Backordered",
      tooltip: "Accepted demand is not fully reserved.",
    };
  }

  if (calculatedStock < 0) {
    return {
      label: "Below safety",
      tooltip: CALCULATED_STOCK_ALERT_TOOLTIP,
    };
  }

  return null;
}

function MarginBadge({ row }: { row: ItemRow }) {
  if (row.marginPercent == null || row.marginTier == null) {
    return "—";
  }

  const variant =
    row.marginTier === "negative"
      ? "destructive"
      : row.marginTier === "low"
        ? "warning"
        : row.marginTier === "high"
          ? "success"
          : "secondary";

  return (
    <Badge variant={variant} className="font-mono text-xs">
      {row.marginPercent}%
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
        const attention = isMaster ? null : getInventoryAttention(row.original);

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
            {attention ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="size-2 shrink-0 cursor-default rounded-full bg-destructive"
                    aria-label={attention.label}
                  />
                </TooltipTrigger>
                <TooltipContent side="top">{attention.tooltip}</TooltipContent>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs">
                    Not sellable
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top">{NOT_SELLABLE_TOOLTIP}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: "category",
      header: ({ column }) => <FilterableHeader column={column} label="Category" />,
      filterFn: categoryFilter,
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
      header: ({ column }) => (
        <SortableHeader column={column} label="Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
      ),
      cell: ({ row }) => formatQuantity(row.getValue("stock")),
    },
    {
      accessorKey: "availableQty",
      sortDescFirst: false,
      sortingFn: (rowA, rowB) =>
        parseFloat(rowA.getValue("availableQty")) -
        parseFloat(rowB.getValue("availableQty")),
      header: ({ column }) => (
        <SortableHeader column={column} label="Available" tooltip={AVAILABLE_QTY_TOOLTIP} />
      ),
      cell: ({ row }) => formatQuantity(row.getValue("availableQty")),
    },
    ...(isProduct && !isSubAssemblies
      ? [
          {
            accessorKey: "marginPercent",
            sortDescFirst: true,
            sortingFn: (rowA, rowB) => {
              const a = rowA.original.marginPercent != null
                ? parseFloat(rowA.original.marginPercent)
                : Number.NEGATIVE_INFINITY;
              const b = rowB.original.marginPercent != null
                ? parseFloat(rowB.original.marginPercent)
                : Number.NEGATIVE_INFINITY;
              return a - b;
            },
            header: ({ column }) => (
              <SortableHeader
                column={column}
                label="Margin"
                tooltip={MARGIN_TOOLTIP}
              />
            ),
            cell: ({ row }) => <MarginBadge row={row.original} />,
          } satisfies ColumnDef<ItemRow>,
          {
            accessorKey: "potential",
            sortDescFirst: false,
            sortingFn: (rowA, rowB) => {
              const a = rowA.original.potential != null ? parseFloat(rowA.original.potential) : -1;
              const b = rowB.original.potential != null ? parseFloat(rowB.original.potential) : -1;
              return a - b;
            },
            header: ({ column }) => (
              <SortableHeader column={column} label="Potential" tooltip={POTENTIAL_TOOLTIP} />
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
      header: () => (
        <TooltipHeader label="Stocking Unit" tooltip={STOCKING_UNIT_TOOLTIP} />
      ),
      cell: ({ row }) => row.original.unit ?? "—",
    },
    {
      accessorKey: "sku",
      header: () => <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />,
      cell: ({ row }) => {
        if (row.original.isMaster) return "—";
        return (row.getValue("sku") as string | null) ?? "—";
      },
    },
  ];
}
