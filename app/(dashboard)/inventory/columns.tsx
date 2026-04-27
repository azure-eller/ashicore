"use client";

import { type ReactNode } from "react";
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
  AVAILABLE_QTY_TOOLTIP,
  BACKORDER_QTY_TOOLTIP,
  CALCULATED_STOCK_ALERT_TOOLTIP,
  CALCULATED_STOCK_TOOLTIP,
  DEMAND_QTY_TOOLTIP,
  NOT_SELLABLE_TOOLTIP,
  POTENTIAL_TOOLTIP,
  RESERVATION_STATUS_TOOLTIP,
  RESERVED_QTY_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatQuantity } from "@/lib/format";
import { calcStock } from "./types";
import type { InventoryProductView, ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

function ReservationStatusBadge({ row }: { row: ItemRow }) {
  const demand = parseFloat(row.demandQty);
  const reserved = parseFloat(row.committedQty);
  const shortage = parseFloat(row.shortageQty);

  if (demand <= 0) {
    return null;
  }

  let badge: ReactNode;
  let tooltip: string;

  if (shortage <= 0) {
    badge = (
      <Badge variant="secondary" className="text-xs">
        Fully reserved
      </Badge>
    );
    tooltip = RESERVATION_STATUS_TOOLTIP.fully;
  } else if (reserved > 0) {
    badge = (
      <Badge variant="outline" className="text-xs">
        Partially reserved
      </Badge>
    );
    tooltip = RESERVATION_STATUS_TOOLTIP.partial;
  } else {
    badge = (
      <Badge variant="destructive" className="text-xs">
        Backordered
      </Badge>
    );
    tooltip = RESERVATION_STATUS_TOOLTIP.backordered;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
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
        const isLow = !isMaster && calcStock(row.original) < 0;

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
            <ReservationStatusBadge row={row.original} />
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
      header: ({ column }) => (
        <SortableHeader column={column} label="Available" tooltip={AVAILABLE_QTY_TOOLTIP} />
      ),
      cell: ({ row }) => formatQuantity(row.getValue("availableQty")),
    },
    {
      accessorKey: "committedQty",
      sortDescFirst: false,
      sortingFn: (rowA, rowB) =>
        parseFloat(rowA.getValue("committedQty")) -
        parseFloat(rowB.getValue("committedQty")),
      header: ({ column }) => (
        <SortableHeader column={column} label="Reserved" tooltip={RESERVED_QTY_TOOLTIP} />
      ),
      cell: ({ row }) => formatQuantity(row.getValue("committedQty")),
    },
    {
      accessorKey: "demandQty",
      sortDescFirst: false,
      sortingFn: (rowA, rowB) =>
        parseFloat(rowA.getValue("demandQty")) -
        parseFloat(rowB.getValue("demandQty")),
      header: ({ column }) => (
        <SortableHeader column={column} label="Demand" tooltip={DEMAND_QTY_TOOLTIP} />
      ),
      cell: ({ row }) => formatQuantity(row.getValue("demandQty")),
    },
    {
      accessorKey: "shortageQty",
      sortDescFirst: false,
      sortingFn: (rowA, rowB) =>
        parseFloat(rowA.getValue("shortageQty")) -
        parseFloat(rowB.getValue("shortageQty")),
      header: ({ column }) => (
        <SortableHeader column={column} label="Backorder" tooltip={BACKORDER_QTY_TOOLTIP} />
      ),
      cell: ({ row }) => {
        const value = row.getValue<string>("shortageQty");
        return (
          <span className={parseFloat(value) > 0 ? "text-destructive" : undefined}>
            {formatQuantity(value)}
          </span>
        );
      },
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
                tooltip="Selling price less BOM material cost, divided by selling price."
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
