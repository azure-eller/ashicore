"use client";

import Link from "next/link";
import type { ICellRendererParams } from "ag-grid-community";
import { Badge } from "@/components/ui/badge";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ColDef } from "@/components/erp-data-grid";
import {
  CALCULATED_STOCK_ALERT_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  MARGIN_TOOLTIP,
  NOT_SELLABLE_TOOLTIP,
  ON_HAND_STOCK_TOOLTIP,
  POTENTIAL_TOOLTIP,
  PROJECTED_VS_SAFETY_TOOLTIP,
  STOCKING_UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { calcProjectedStock, calcStock, getReplenishmentStatus } from "./types";
import type { ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

type InventoryAttention = {
  label: string;
  tooltip: string;
};

const marginTierClass: Record<NonNullable<ItemRow["marginTier"]>, string> = {
  negative: "bg-[var(--status-danger-bg)] text-[var(--status-danger-solid-ink)]",
  low: "bg-[var(--status-muted-bg)] text-[var(--color-ink)]",
  mid: "bg-[var(--status-warning-bg)] text-[var(--status-warning-solid-ink)]",
  high: "bg-[var(--status-success-bg)] text-[var(--status-success-solid-ink)]",
};

function getInventoryAttention(row: ItemRow): InventoryAttention | null {
  const calculatedStock = calcStock(row);

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

  return (
    <span
      className={cn(
        "inline-flex h-(--space-10) w-fit items-center rounded-[var(--radius-pill)] px-(--space-3) font-mono text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-bold tabular-nums",
        marginTierClass[row.marginTier]
      )}
    >
      {row.marginPercent}%
    </span>
  );
}

function ProjectedSafetyCell({ row }: { row: ItemRow }) {
  const projected = Math.max(0, calcProjectedStock(row));
  const parsedSafety = parseFloat(row.safetyStock);
  const safety = Number.isFinite(parsedSafety) ? Math.max(0, parsedSafety) : 0;
  const status = getReplenishmentStatus(row);
  const projectedPercent =
    safety > 0 ? Math.min(100, (projected / safety) * 50) : projected > 0 ? 100 : 0;
  const fillClass =
    status === "order-now"
      ? "bg-[var(--status-danger-ink)]"
      : status === "order-soon"
        ? "bg-[var(--status-warning-ink)]"
        : "bg-[var(--status-success-ink)]";

  return (
    <div className="flex h-full min-w-0 max-w-full flex-col justify-center gap-(--space-2)">
      <div className="relative h-2 rounded-full bg-[var(--color-line-soft)]">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", fillClass)}
          style={{ width: `${projectedPercent}%` }}
        />
        {safety > 0 ? (
          <span
            aria-hidden
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-[var(--color-ink)]"
            style={{ left: "50%" }}
          />
        ) : null}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-(--space-1) xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <QuantityWithUnit
          value={projected}
          unitName={row.unit}
          unitSize={row.unitSize}
          unitUom={row.unitUom}
          className="text-[length:var(--text-xs)]"
          valueClassName="font-medium text-[var(--color-ink)]"
        />
        <QuantityWithUnit
          label="safety"
          value={safety}
          unitName={row.unit}
          unitSize={row.unitSize}
          unitUom={row.unitUom}
          className="text-[length:var(--text-xs)]"
          muted
        />
      </div>
    </div>
  );
}

function NameCell({
  row,
  isProduct,
}: {
  row: ItemRow;
  isProduct: boolean;
}) {
  const attention = getInventoryAttention(row);

  return (
    <div className="flex h-full min-w-0 items-center gap-(--space-3)">
      {attention ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="relative size-(--space-5) shrink-0 cursor-default rounded-[var(--radius-full)] bg-[var(--color-danger-soft)] before:absolute before:inset-1/2 before:size-(--space-2) before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-[var(--radius-full)] before:bg-[var(--status-danger-ink)]"
              aria-label={attention.label}
            />
          </TooltipTrigger>
          <TooltipContent side="top">{attention.tooltip}</TooltipContent>
        </Tooltip>
      ) : null}
      <Link
        href={`/inventory/${ITEM_TYPE_SEGMENTS[row.itemType]}/${row.id}`}
        prefetch={false}
        className="truncate hover:underline"
      >
        {row.displayName}
      </Link>
      {isProduct && row.sellable === false ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline">
              Not sellable
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">{NOT_SELLABLE_TOOLTIP}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function getColumns(itemType: ItemType): ColDef<ItemRow>[] {
  const isProduct = itemType === "product";

  return [
    {
      field: "displayName",
      headerName: "Name",
      width: 300,
      minWidth: 220,
      flex: 1.3,
      cellRenderer: ({ data }: ICellRendererParams<ItemRow>) =>
        data ? <NameCell row={data} isProduct={isProduct} /> : null,
      getQuickFilterText: ({ data }) =>
        [data?.displayName, data?.name, data?.sku, data?.category]
          .filter(Boolean)
          .join(" "),
    },
    {
      field: "category",
      headerName: "Category",
      width: 170,
      valueFormatter: ({ value }) => value ?? "—",
    },
    {
      field: "stock",
      headerName: "Stock",
      headerTooltip: ON_HAND_STOCK_TOOLTIP,
      width: 130,
      comparator: (left, right) =>
        parseFloat(String(left ?? "0")) - parseFloat(String(right ?? "0")),
      valueFormatter: ({ value }) => formatQuantity(String(value ?? "0")),
    },
    ...(!isProduct
      ? [
          {
            field: "unit",
            headerName: "Stocking Unit",
            headerTooltip: STOCKING_UNIT_TOOLTIP,
            width: 150,
            valueFormatter: ({ value }) => value ?? "—",
          } satisfies ColDef<ItemRow>,
          {
            colId: "projectedSafety",
            headerName: "Projected vs safety",
            headerTooltip: PROJECTED_VS_SAFETY_TOOLTIP,
            width: 280,
            minWidth: 230,
            valueGetter: ({ data }) => (data ? getReplenishmentStatus(data) : ""),
            comparator: (_left, _right, leftNode, rightNode) =>
              (leftNode.data ? calcProjectedStock(leftNode.data) : 0) -
              (rightNode.data ? calcProjectedStock(rightNode.data) : 0),
            cellRenderer: ({ data }: ICellRendererParams<ItemRow>) =>
              data ? <ProjectedSafetyCell row={data} /> : null,
          } satisfies ColDef<ItemRow>,
        ]
      : []),
    ...(isProduct
      ? [
          {
            field: "marginPercent",
            headerName: "Margin",
            headerTooltip: MARGIN_TOOLTIP,
            width: 130,
            comparator: (_left, _right, leftNode, rightNode) => {
              const left =
                leftNode.data?.marginPercent != null
                  ? parseFloat(leftNode.data.marginPercent)
                  : Number.NEGATIVE_INFINITY;
              const right =
                rightNode.data?.marginPercent != null
                  ? parseFloat(rightNode.data.marginPercent)
                  : Number.NEGATIVE_INFINITY;
              return left - right;
            },
            cellRenderer: ({ data }: ICellRendererParams<ItemRow>) =>
              data ? <MarginBadge row={data} /> : null,
          } satisfies ColDef<ItemRow>,
          {
            field: "potential",
            headerName: "Potential",
            headerTooltip: POTENTIAL_TOOLTIP,
            width: 130,
            comparator: (left, right) =>
              parseFloat(String(left ?? "-1")) - parseFloat(String(right ?? "-1")),
            cellRenderer: ({ data }: ICellRendererParams<ItemRow>) => {
              const val = data?.potential;
              if (val == null) return "—";
              const num = parseFloat(val);
              return (
                <span className={num <= 0 ? "text-[var(--color-ink-faint)]" : undefined}>
                  {num}
                </span>
              );
            },
          } satisfies ColDef<ItemRow>,
        ]
      : []),
    ...(isProduct
      ? [
          {
            field: "unit",
            headerName: "Stocking Unit",
            headerTooltip: STOCKING_UNIT_TOOLTIP,
            width: 150,
            valueFormatter: ({ value }) => value ?? "—",
          } satisfies ColDef<ItemRow>,
        ]
      : []),
    {
      field: "sku",
      headerName: "SKU",
      headerTooltip: ITEM_SKU_TOOLTIP,
      width: 170,
      valueFormatter: ({ value }) => value ?? "—",
    },
  ];
}
