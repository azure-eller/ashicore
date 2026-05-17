"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ColDef,
  ColGroupDef,
  GridApi,
  GridReadyEvent,
  ICellRendererParams,
  RowClassParams,
} from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { ERPDataGrid } from "@/components/erp-data-grid";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiJson } from "@/lib/client/api";
import { formatQuantity } from "@/lib/format";
import type { ItemRow } from "@/app/(dashboard)/inventory/types";
import {
  ALLOCATOR_PREFERENCE_ENDPOINT,
  AllocationSourceDialog,
  productLabel,
  type AllocationTarget,
  type AllocatorPreference,
  type AllocatorProduct,
} from "./sales-order-allocator";
import type { SalesOrderListLine, SalesOrderListRow } from "./types";
import styles from "./sales-allocation-table.module.css";

const OPEN_SALES_STATUSES = ["open"] as const;
const STANDALONE_FAMILY_LABEL = "Standalone Products";
const CUSTOMER_COL_WIDTH = 230;
const SHIP_COL_WIDTH = 118;
const PRODUCT_COL_WIDTH = 96;

type AllocationProduct = AllocatorProduct & {
  stockQty: number;
  incomingQty: number;
  allocatedQty: number;
  reservationSummaries: string[];
  isStandalone: boolean;
};

export type AllocationPoolRow = {
  itemId: string;
  stockQty: string;
  incomingQty: string;
  stockAllocatedQty?: string;
  incomingAllocatedQty?: string;
  allocatedQty: string;
  assignments: Array<{
    demandLabel: string;
    quantity: string;
  }>;
  reservations: Array<{
    demandLabel: string;
    quantity: string;
  }>;
};

type AllocationCell = {
  line: SalesOrderListLine & { id: string };
  product: AllocationProduct;
  demand: number;
  alloc: number;
};

type AllocationRow = {
  id: string;
  order: SalesOrderListRow;
  label: string;
  demandTypeLabel: "Planned shipment" | "Unplanned demand";
  demandContext: string;
  customerName: string;
  shipDate: string | null;
  cells: Map<string, AllocationCell>;
};

type RowProgress = {
  state: "empty" | "complete" | "partial" | "unallocated";
  demand: number;
  alloc: number;
};

type ColumnCoverage = {
  product: AllocationProduct;
  demand: number;
  alloc: number;
  stock: number;
  incoming: number;
  pool: number;
  surplus: number;
  verdict: "idle" | "ok" | "tight" | "short";
};

type SalesAllocationGridRow =
  | {
      id: string;
      rowType: "order";
      order: SalesOrderListRow;
      label: string;
      demandTypeLabel: "Planned shipment" | "Unplanned demand";
      demandContext: string;
      customerName: string;
      shipDate: string | null;
      cells: Map<string, AllocationCell>;
      progress: RowProgress;
      lateDays: number | null;
      isToday: boolean;
    }
  | {
      id: "coverage";
      rowType: "coverage";
      coverageByProductId: Map<string, ColumnCoverage>;
    }
  | {
      id: "totals";
      rowType: "totals";
      coverageByProductId: Map<string, ColumnCoverage>;
    };

type BulkAllocationAction = "allocate_fifo" | "unallocate_open";

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
}

function parseQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactQuantity(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    return `${(value / 1000).toFixed(absolute >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return formatQuantity(value.toFixed(4).replace(/\.?0+$/, ""));
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function productColId(productId: string) {
  return `product:${productId}`;
}

function flattenProducts(items: ItemRow[]) {
  return items.flatMap((item) =>
    item.subRows && item.subRows.length > 0 ? item.subRows : [item]
  );
}

function getInventoryById(items: ItemRow[]) {
  return new Map(flattenProducts(items).map((item) => [item.id, item]));
}

function getAllocatorProducts(orders: SalesOrderListRow[], inventory: ItemRow[]) {
  const inventoryById = getInventoryById(inventory);
  const byId = new Map<string, AllocationProduct>();

  orders.forEach((order) => {
    if (!isOpenSalesOrder(order)) return;

    order.lines.forEach((line) => {
      if (line.itemType !== "product") return;
      if (byId.has(line.itemId)) return;

      const inventoryItem = inventoryById.get(line.itemId);
      const isStandalone = line.attrs.length === 0;

      byId.set(line.itemId, {
        itemId: line.itemId,
        label: productLabel(line),
        familyLabel: isStandalone ? STANDALONE_FAMILY_LABEL : line.masterName,
        variantLabel: isStandalone ? line.masterName : line.attrs.join(" "),
        sku: line.itemSku ?? null,
        unitName: line.unitName,
        stockQty: parseQuantity(inventoryItem?.availableQty),
        incomingQty: parseQuantity(inventoryItem?.expectedQty),
        allocatedQty: 0,
        reservationSummaries: [],
        isStandalone,
      });
    });
  });

  return [...byId.values()].sort((left, right) => {
    if (left.isStandalone !== right.isStandalone) {
      return left.isStandalone ? 1 : -1;
    }
    const familyCompare = left.familyLabel.localeCompare(right.familyLabel);
    if (familyCompare !== 0) return familyCompare;
    return left.label.localeCompare(right.label);
  });
}

function buildRows(orders: SalesOrderListRow[], products: AllocationProduct[]) {
  const productById = new Map(products.map((product) => [product.itemId, product]));

  return orders
    .filter(isOpenSalesOrder)
    .flatMap((order): AllocationRow[] => {
      const rows: AllocationRow[] = [];
      const orderLineById = new Map(
        order.lines
          .filter((line) => line.id)
          .map((line) => [line.id as string, line])
      );
      const plannedByOrderLineId = new Map<string, number>();

      order.shipments
        .filter((shipment) => shipment.status === "planned")
        .forEach((shipment) => {
          const cells = new Map<string, AllocationCell>();

          shipment.lines.forEach((shipmentLine) => {
            const product = productById.get(shipmentLine.itemId);
            if (!product) return;
            const orderLine = orderLineById.get(shipmentLine.salesOrderLineId);
            plannedByOrderLineId.set(
              shipmentLine.salesOrderLineId,
              (plannedByOrderLineId.get(shipmentLine.salesOrderLineId) ?? 0) +
                parseQuantity(shipmentLine.quantity)
            );
            const demandLine: SalesOrderListLine & { id: string } = {
              id: shipmentLine.id,
              allocationDemandType: "sales_shipment_line",
              salesOrderLineId: shipmentLine.salesOrderLineId,
              salesShipmentLineId: shipmentLine.id,
              shipmentId: shipment.id,
              shipmentNumber: shipment.shipmentNumber,
              itemId: shipmentLine.itemId,
              itemType: "product",
              masterName: orderLine?.masterName ?? shipmentLine.itemName,
              attrs: orderLine?.attrs ?? [],
              itemSku: shipmentLine.itemSku,
              quantity: shipmentLine.quantity,
              remainingQty: shipmentLine.quantity,
              allocatedQty: shipmentLine.allocatedQty ?? "0",
              shortQty: shipmentLine.shortQty ?? shipmentLine.quantity,
              sourceSummary: shipmentLine.sourceSummary ?? "-",
              allocationStatus: shipmentLine.allocationStatus ?? "short",
              unitName: shipmentLine.unitName,
            };

            cells.set(product.itemId, {
              line: demandLine,
              product,
              demand: parseQuantity(demandLine.remainingQty ?? demandLine.quantity),
              alloc: parseQuantity(demandLine.allocatedQty),
            });
          });

          if (cells.size > 0) {
            rows.push({
              id: `shipment:${shipment.id}`,
              order,
              label: shipment.shipmentNumber,
              demandTypeLabel: "Planned shipment",
              demandContext: `Assigned to shipment ${shipment.shipmentNumber}`,
              customerName: order.customerName,
              shipDate: shipment.scheduledDate ?? order.shipDate,
              cells,
            });
          }
        });

      const fallbackCells = new Map<string, AllocationCell>();
      order.lines.forEach((line) => {
        if (!line.id) return;
        const remainingQty = parseQuantity(line.remainingQty ?? line.quantity);
        const unplannedQty =
          remainingQty - (plannedByOrderLineId.get(line.id) ?? 0);
        if (unplannedQty <= 0) return;
        const product = productById.get(line.itemId);
        if (!product) return;
        const unplannedQuantity = quantityString(unplannedQty);
        const demandLine: SalesOrderListLine & { id: string } = {
          ...line,
          id: line.id,
          allocationDemandType: "sales_order_line",
          quantity: unplannedQuantity,
          remainingQty: unplannedQuantity,
          allocatedQty: line.unplannedAllocatedQty ?? "0",
          shortQty: line.unplannedShortQty ?? unplannedQuantity,
          sourceSummary: line.unplannedSourceSummary ?? "-",
          allocationStatus: line.unplannedAllocationStatus ?? "short",
        };
        fallbackCells.set(product.itemId, {
          line: demandLine,
          product,
          demand: parseQuantity(demandLine.remainingQty ?? demandLine.quantity),
          alloc: parseQuantity(demandLine.allocatedQty),
        });
      });
      if (fallbackCells.size > 0) {
        rows.push({
          id: `order:${order.id}`,
          order,
          label: order.orderNumber,
          demandTypeLabel: "Unplanned demand",
          demandContext: "Not assigned to a shipment yet",
          customerName: order.customerName,
          shipDate: order.shipDate,
          cells: fallbackCells,
        });
      }

      return rows;
    })
    .sort((left, right) => {
      const leftDate = left.shipDate ?? "";
      const rightDate = right.shipDate ?? "";
      if (!leftDate && rightDate) return 1;
      if (leftDate && !rightDate) return -1;
      const dateCompare = leftDate.localeCompare(rightDate);
      if (dateCompare !== 0) return dateCompare;
      return left.label.localeCompare(right.label, undefined, {
        numeric: true,
      });
    });
}

function rowProgress(row: AllocationRow): RowProgress {
  let demand = 0;
  let alloc = 0;
  let anyDemand = false;

  row.cells.forEach((cell) => {
    if (cell.demand > 0) anyDemand = true;
    demand += cell.demand || 0;
    alloc += cell.alloc || 0;
  });

  if (!anyDemand) return { state: "empty", demand: 0, alloc: 0 };
  if (alloc >= demand) return { state: "complete", demand, alloc };
  if (alloc > 0) return { state: "partial", demand, alloc };
  return { state: "unallocated", demand, alloc };
}

function businessDateToUtcDays(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function todayBusinessDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function daysFromToday(value: string | null) {
  if (!value) return null;
  const target = businessDateToUtcDays(value);
  const today = businessDateToUtcDays(todayBusinessDate());
  if (target == null || today == null) return null;
  return target - today;
}

function formatShipDate(value: string | null) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function relativeShipLabel(value: string | null) {
  const days = daysFromToday(value);
  if (days == null) return "";
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)}d late`;
  return `in ${days}d`;
}

function getRowLateState(row: AllocationRow) {
  const days = daysFromToday(row.shipDate);
  if (days == null || days >= 0) return null;
  const progress = rowProgress(row);
  if (progress.state === "complete" || progress.state === "empty") return null;
  return { daysLate: Math.abs(days) };
}

function getCoverage(products: AllocationProduct[], rows: AllocationRow[]) {
  return new Map(
    products.map((product): [string, ColumnCoverage] => {
      const demand = rows.reduce((sum, row) => {
        const cell = row.cells.get(product.itemId);
        return sum + (cell?.demand ?? 0);
      }, 0);
      const alloc = rows.reduce((sum, row) => {
        const cell = row.cells.get(product.itemId);
        return sum + (cell?.alloc ?? 0);
      }, 0);
      const pool = product.stockQty + product.incomingQty;
      const surplus = pool - demand;
      let verdict: ColumnCoverage["verdict"] = "idle";

      if (demand > 0) {
        if (surplus < 0) verdict = "short";
        else if (surplus < demand * 0.1) verdict = "tight";
        else verdict = "ok";
      }

      return [
        product.itemId,
        {
          product,
          demand,
          alloc,
          stock: product.stockQty,
          incoming: product.incomingQty,
          pool,
          surplus,
          verdict,
        },
      ];
    })
  );
}

function getCellStatus(cell: Pick<AllocationCell, "alloc" | "demand"> | null) {
  if (!cell || cell.demand <= 0) return "empty";
  if (cell.alloc >= cell.demand) return "met";
  if (cell.alloc > 0) return "partial";
  return "short";
}

function getCoverageLabel(coverage: ColumnCoverage) {
  if (coverage.demand <= 0) return { text: "-", tone: "idle" as const };
  if (coverage.verdict === "short") {
    return {
      text: `short ${compactQuantity(Math.abs(coverage.surplus))}`,
      tone: "short" as const,
    };
  }
  if (coverage.verdict === "tight") {
    return {
      text: `tight +${compactQuantity(coverage.surplus)}`,
      tone: "partial" as const,
    };
  }
  return { text: `+${compactQuantity(coverage.surplus)}`, tone: "met" as const };
}

function getFilteredRows(rows: AllocationRow[], search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) => {
    if (row.customerName.toLowerCase().includes(normalized)) return true;
    if (row.label.toLowerCase().includes(normalized)) return true;
    if (row.order.orderNumber.toLowerCase().includes(normalized)) return true;

    return [...row.cells.values()].some((cell) => {
      if (cell.demand <= 0 && cell.alloc <= 0) return false;
      const sku = cell.product.sku?.toLowerCase() ?? "";
      return (
        cell.product.label.toLowerCase().includes(normalized) ||
        cell.product.familyLabel.toLowerCase().includes(normalized) ||
        sku.includes(normalized)
      );
    });
  });
}

function getProductColumnToReveal(
  rows: AllocationRow[],
  visibleProducts: AllocationProduct[],
  search: string
) {
  const visibleProductIds = new Set(visibleProducts.map((product) => product.itemId));
  const normalized = search.trim().toLowerCase();

  if (normalized) {
    for (const product of visibleProducts) {
      const sku = product.sku?.toLowerCase() ?? "";
      const matchesProduct =
        product.label.toLowerCase().includes(normalized) ||
        product.familyLabel.toLowerCase().includes(normalized) ||
        sku.includes(normalized);

      if (!matchesProduct) continue;

      const hasVisibleDemand = rows.some((row) => {
        const cell = row.cells.get(product.itemId);
        return cell != null && (cell.demand > 0 || cell.alloc > 0);
      });

      if (hasVisibleDemand) return product.itemId;
    }
  }

  if (normalized && rows.length === 1) {
    for (const product of visibleProducts) {
      const cell = rows[0].cells.get(product.itemId);
      if (cell != null && (cell.demand > 0 || cell.alloc > 0)) {
        return product.itemId;
      }
    }
  }

  for (const row of rows) {
    for (const cell of row.cells.values()) {
      if (
        visibleProductIds.has(cell.product.itemId) &&
        (cell.demand > 0 || cell.alloc > 0)
      ) {
        return cell.product.itemId;
      }
    }
  }

  return null;
}

function todayLabel() {
  return formatShipDate(todayBusinessDate());
}

function isToday(value: string | null) {
  return value === todayBusinessDate();
}

function buildGridRows(rows: AllocationRow[]): SalesAllocationGridRow[] {
  return rows.map((row) => ({
    id: row.id,
    rowType: "order",
    order: row.order,
    label: row.label,
    demandTypeLabel: row.demandTypeLabel,
    demandContext: row.demandContext,
    customerName: row.customerName,
    shipDate: row.shipDate,
    cells: row.cells,
    progress: rowProgress(row),
    lateDays: getRowLateState(row)?.daysLate ?? null,
    isToday: isToday(row.shipDate),
  }));
}

function ProductHeader({
  product,
  onHide,
}: {
  product: AllocationProduct;
  onHide: (productId: string) => void;
}) {
  return (
    <div className={styles.productHeader}>
      <span className={styles.variantName}>{product.variantLabel}</span>
      <span className={styles.sku}>{product.sku ?? product.unitName}</span>
      <button
        type="button"
        className={styles.hideColumnAction}
        aria-label={`Hide ${product.label}`}
        onClick={(event) => {
          event.stopPropagation();
          onHide(product.itemId);
        }}
      >
        x
      </button>
    </div>
  );
}

function CustomerCell({ data }: ICellRendererParams<SalesAllocationGridRow>) {
  if (!data) return null;
  if (data.rowType === "coverage") {
    return (
      <div className={styles.summaryIdentityCell}>
        <span>Coverage</span>
        <small>Pool vs demand</small>
      </div>
    );
  }
  if (data.rowType === "totals") {
    return <span className={styles.summaryLabel}>Allocated / Demand</span>;
  }

  const isComplete = data.progress.state === "complete";
  return (
    <div className={styles.customerCell} data-row-tone={data.lateDays != null ? "late" : data.progress.state}>
      <Link href={`/sales/orders/${data.order.id}`} className={styles.customerName}>
        {data.customerName}
        {isComplete ? (
          <span className={styles.completeMark} title="Order fully allocated">
            ✓
          </span>
        ) : null}
      </Link>
      <span className={styles.orderNumber}>{data.label}</span>
      <span className={styles.demandTypeBadge} title={data.demandContext}>
        {data.demandTypeLabel}
      </span>
    </div>
  );
}

function ShipCell({ data }: ICellRendererParams<SalesAllocationGridRow>) {
  if (!data) return null;
  if (data.rowType === "coverage") {
    return (
      <div className={styles.summaryIdentityCell}>
        <span>Today</span>
        <small>{todayLabel()}</small>
      </div>
    );
  }
  if (data.rowType === "totals") {
    return <span className={styles.summaryLabel}>vs pool</span>;
  }

  return (
    <div className={styles.shipCell}>
      <span className={styles.shipDate}>
        {data.shipDate == null
          ? "Not assigned"
          : data.isToday
            ? "Today"
            : formatShipDate(data.shipDate)}
      </span>
      {data.lateDays != null ? (
        <span className={styles.relativeBadge}>
          {relativeShipLabel(data.shipDate)}
        </span>
      ) : data.shipDate == null ? (
        <span className={styles.relativeBadge} data-tone="neutral">
          Unplanned
        </span>
      ) : null}
    </div>
  );
}

function CoverageSummaryCell({ coverage }: { coverage: ColumnCoverage | undefined }) {
  if (!coverage) return null;
  const label = getCoverageLabel(coverage);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={styles.coverageSummary}>
          <div className={styles.verdict} data-tone={label.tone}>
            {label.text}
          </div>
          <div className={styles.coverageSubline}>
            <span>pool {compactQuantity(coverage.pool)}</span>
            <span>need {compactQuantity(coverage.demand)}</span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="block font-mono text-[11px] leading-4 tabular-nums"
      >
        <div className="grid grid-cols-[auto_auto] gap-x-3">
          <span>STOCK</span>
          <span className="text-right">{compactQuantity(coverage.stock)}</span>
          <span>+ MO</span>
          <span className="text-right">{compactQuantity(coverage.incoming)}</span>
          <span className="col-span-2 my-0.5 border-t border-background/45" />
          <span>= POOL</span>
          <span className="text-right">{compactQuantity(coverage.pool)}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function TotalsSummaryCell({ coverage }: { coverage: ColumnCoverage | undefined }) {
  if (!coverage) return null;
  const label = getCoverageLabel(coverage);

  return (
    <div className={styles.totalCell}>
      <div>
        <span>
          {compactQuantity(coverage.alloc)} / {compactQuantity(coverage.demand)}
        </span>
        <strong>{compactQuantity(coverage.pool)}</strong>
      </div>
      <span className={styles.footerVerdict} data-tone={label.tone}>
        <span />
        {coverage.demand > 0 ? label.text.replace("+", "surplus ") : "no demand"}
      </span>
    </div>
  );
}

function AllocationProductCell({
  data,
  product,
  selected,
  onOpenAllocation,
}: ICellRendererParams<SalesAllocationGridRow> & {
  product: AllocationProduct;
  selected: { rowId: string; colId: string } | null;
  onOpenAllocation: (row: SalesAllocationGridRow, cell: AllocationCell) => void;
}) {
  if (!data) return null;

  if (data.rowType === "coverage") {
    return (
      <CoverageSummaryCell
        coverage={data.coverageByProductId.get(product.itemId)}
      />
    );
  }

  if (data.rowType === "totals") {
    return (
      <TotalsSummaryCell
        coverage={data.coverageByProductId.get(product.itemId)}
      />
    );
  }

  const cell = data.cells.get(product.itemId) ?? null;
  const status = getCellStatus(cell);
  const isSelected =
    selected?.rowId === data.id && selected.colId === product.itemId;

  return (
    <button
      type="button"
      className={styles.matrixCell}
      data-status={status}
      data-today={data.isToday ? "true" : undefined}
      data-selected={isSelected ? "true" : undefined}
      onClick={() => {
        if (cell) onOpenAllocation(data, cell);
      }}
      disabled={!cell}
      aria-label={cell ? `Allocate ${product.label}` : `${product.label} not ordered`}
    >
      {cell ? (
        <span className={styles.cellQty}>
          {status === "met" ? <span className={styles.inlineCheck}>✓</span> : null}
          <strong>{compactQuantity(cell.alloc)}</strong>
          <span className={styles.slash}>/</span>
          <span>{compactQuantity(cell.demand)}</span>
        </span>
      ) : null}
    </button>
  );
}

function Chip({
  tone,
  label,
}: {
  tone: "short" | "partial" | "met" | "neutral";
  label: string;
}) {
  return (
    <span className={styles.chip} data-tone={tone}>
      <span />
      {label}
    </span>
  );
}

function HiddenColumnsMenu({
  hiddenProducts,
  onRestore,
  onShowAll,
}: {
  hiddenProducts: AllocationProduct[];
  onRestore: (productId: string) => void;
  onShowAll: () => void;
}) {
  const byFamily = hiddenProducts.reduce((groups, product) => {
    const bucket = groups.get(product.familyLabel) ?? [];
    bucket.push(product);
    groups.set(product.familyLabel, bucket);
    return groups;
  }, new Map<string, AllocationProduct[]>());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={styles.hiddenPill}>
          {hiddenProducts.length} hidden columns
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Hidden columns</DropdownMenuLabel>
          <Button type="button" variant="ghost" size="sm" onClick={onShowAll}>
            Show all
          </Button>
        </div>
        <DropdownMenuSeparator />
        {[...byFamily.entries()].map(([family, products]) => (
          <div key={family}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {family}
            </DropdownMenuLabel>
            {products.map((product) => (
              <DropdownMenuItem
                key={product.itemId}
                onClick={() => onRestore(product.itemId)}
              >
                {product.variantLabel} · {product.familyLabel}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SalesAllocationTable({
  initialData,
  initialPools,
  organizationId,
}: {
  initialData: SalesOrderListRow[];
  initialPools?: AllocationPoolRow[];
  organizationId: string;
}) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const gridApiRef = useRef<GridApi<SalesAllocationGridRow> | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ rowId: string; colId: string } | null>(
    null
  );
  const [allocationTarget, setAllocationTarget] = useState<AllocationTarget | null>(
    null
  );
  const [pendingBulkAction, setPendingBulkAction] =
    useState<BulkAllocationAction | null>(null);
  const { data: orders = initialData } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
      }),
    initialData,
  });
  const { data: inventory = [] } = useQuery({
    queryKey: ["items", organizationId, "product"],
    queryFn: () =>
      apiJson<ItemRow[]>("/api/items?itemType=product", {
        fallbackError: "Failed to fetch product inventory.",
      }).then((rows) => rows.filter((row) => row.sellable === true)),
    initialData: [] as ItemRow[],
  });
  const preferenceQuery = useQuery({
    queryKey: ["sales-orders-allocator-preference"],
    queryFn: () =>
      apiJson<AllocatorPreference>(ALLOCATOR_PREFERENCE_ENDPOINT, {
        fallbackError: "Failed to load allocator preferences.",
      }),
    initialData: { hiddenProductIds: [] },
  });
  const hiddenProductIds = preferenceQuery.data.hiddenProductIds;
  const hiddenProductIdSet = useMemo(
    () => new Set(hiddenProductIds),
    [hiddenProductIds]
  );
  const preferenceMutation = useMutation({
    mutationFn: (nextHiddenProductIds: string[]) =>
      apiJson<AllocatorPreference>(ALLOCATOR_PREFERENCE_ENDPOINT, {
        method: "PUT",
        body: { hiddenProductIds: nextHiddenProductIds },
        fallbackError: "Failed to save allocator preferences.",
      }),
    onMutate: async (nextHiddenProductIds) => {
      await queryClient.cancelQueries({
        queryKey: ["sales-orders-allocator-preference"],
      });
      const previous = queryClient.getQueryData<AllocatorPreference>([
        "sales-orders-allocator-preference",
      ]);
      queryClient.setQueryData<AllocatorPreference>(
        ["sales-orders-allocator-preference"],
        { hiddenProductIds: nextHiddenProductIds }
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["sales-orders-allocator-preference"],
          context.previous
        );
      }
    },
    onSuccess: (preference) => {
      queryClient.setQueryData(
        ["sales-orders-allocator-preference"],
        preference
      );
    },
  });
  const bulkAllocationMutation = useMutation({
    mutationFn: (action: BulkAllocationAction) =>
      apiJson<{
        action: BulkAllocationAction;
        itemCount: number;
        lineCount: number;
        quantity: string;
      }>("/api/allocation/sales-orders/bulk", {
        method: "POST",
        body: { action },
        fallbackError: "Failed to update sales allocations.",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["allocation-pools"] });
      void queryClient.invalidateQueries({ queryKey: ["allocation-workspace"] });
      setPendingBulkAction(null);
    },
    onError: (error) => {
      window.alert(
        error instanceof Error
          ? error.message
          : "Failed to update sales allocations."
      );
    },
  });

  const allProducts = useMemo(
    () => getAllocatorProducts(orders, inventory),
    [orders, inventory]
  );
  const poolParams = useMemo(() => {
    const params = new URLSearchParams();
    allProducts.forEach((product) => params.append("itemId", product.itemId));
    return params.toString();
  }, [allProducts]);
  const { data: allocationPools = [] } = useQuery({
    queryKey: ["allocation-pools", poolParams],
    enabled: poolParams.length > 0,
    queryFn: () =>
      apiJson<AllocationPoolRow[]>(`/api/allocation/pools?${poolParams}`, {
        fallbackError: "Failed to fetch allocation pools.",
      }),
    initialData: initialPools,
  });
  const productsWithPools = useMemo(() => {
    const poolsByItemId = new Map(
      allocationPools.map((pool) => [pool.itemId, pool])
    );
    return allProducts.map((product) => {
      const pool = poolsByItemId.get(product.itemId);
      if (!pool) return product;
      return {
        ...product,
        stockQty:
          parseQuantity(pool.stockQty) + parseQuantity(pool.stockAllocatedQty),
        incomingQty:
          parseQuantity(pool.incomingQty) + parseQuantity(pool.incomingAllocatedQty),
        allocatedQty: parseQuantity(pool.allocatedQty),
        reservationSummaries: [
          ...pool.assignments.map(
            (assignment) =>
              `${compactQuantity(parseQuantity(assignment.quantity))} ${assignment.demandLabel}`
          ),
          ...pool.reservations
            .filter(
              (reservation) =>
                !pool.assignments.some(
                  (assignment) => assignment.demandLabel === reservation.demandLabel
                )
            )
            .map(
              (reservation) =>
                `${compactQuantity(parseQuantity(reservation.quantity))} reserved ${reservation.demandLabel}`
            ),
        ],
      };
    });
  }, [allProducts, allocationPools]);
  const visibleProducts = useMemo(
    () =>
      productsWithPools.filter((product) => !hiddenProductIdSet.has(product.itemId)),
    [productsWithPools, hiddenProductIdSet]
  );
  const allRows = useMemo(
    () => buildRows(orders, productsWithPools),
    [orders, productsWithPools]
  );
  const rows = useMemo(() => getFilteredRows(allRows, search), [allRows, search]);
  const gridRows = useMemo(() => buildGridRows(rows), [rows]);
  const coverageById = useMemo(
    () => getCoverage(visibleProducts, rows),
    [visibleProducts, rows]
  );
  const pinnedTopRows = useMemo<SalesAllocationGridRow[]>(
    () => [{ id: "coverage", rowType: "coverage", coverageByProductId: coverageById }],
    [coverageById]
  );
  const highlightedOrderId = searchParams.get("highlightOrderId");
  const hiddenProducts = allProducts.filter(
    (product) => hiddenProductIdSet.has(product.itemId)
  );
  const totals = rows.reduce(
    (acc, row) => {
      const progress = rowProgress(row);
      const late = getRowLateState(row);
      acc.alloc += progress.alloc;
      acc.demand += progress.demand;
      if (late) acc.late += 1;
      if (progress.state === "complete") acc.complete += 1;
      row.cells.forEach((cell) => {
        if (cell.demand > cell.alloc) acc.shortLines += 1;
        if (cell.demand > 0) acc.lines += 1;
      });
      return acc;
    },
    { late: 0, complete: 0, shortLines: 0, lines: 0, alloc: 0, demand: 0 }
  );

  const hideColumn = useCallback(
    (productId: string) => {
      preferenceMutation.mutate([...new Set([...hiddenProductIds, productId])]);
    },
    [hiddenProductIds, preferenceMutation]
  );

  function restoreColumn(productId: string) {
    preferenceMutation.mutate(hiddenProductIds.filter((id) => id !== productId));
  }

  function showAllColumns() {
    preferenceMutation.mutate([]);
  }

  function openAllocation(row: SalesAllocationGridRow, cell: AllocationCell) {
    if (row.rowType !== "order") return;

    setSelected({ rowId: row.id, colId: cell.product.itemId });
    setAllocationTarget({
      order: row.order,
      line: cell.line,
      product: cell.product,
      targetQty: quantityString(cell.demand),
    });
  }

  const scrollHighlightedOrderIntoView = useCallback(() => {
    if (!highlightedOrderId) return;
    const api = gridApiRef.current;
    if (!api) return;

    let node = api.getRowNode(`order:${highlightedOrderId}`) ?? null;
    if (!node) {
      api.forEachNode((rowNode) => {
        if (
          !node &&
          rowNode.data?.rowType === "order" &&
          rowNode.data.order.id === highlightedOrderId
        ) {
          node = rowNode;
        }
      });
    }
    if (node) {
      api.ensureNodeVisible(node, "middle");
    }
  }, [highlightedOrderId]);

  useEffect(() => {
    scrollHighlightedOrderIntoView();
  }, [gridRows.length, scrollHighlightedOrderIntoView]);

  useEffect(() => {
    if (!search.trim()) return;
    const api = gridApiRef.current;
    if (!api) return;

    const productId = getProductColumnToReveal(rows, visibleProducts, search);
    if (!productId) return;

    api.ensureColumnVisible(productColId(productId), "middle");
  }, [rows, search, visibleProducts]);

  const columns = useMemo<Array<ColDef<SalesAllocationGridRow> | ColGroupDef<SalesAllocationGridRow>>>(
    () => {
      const productGroups = new Map<string, AllocationProduct[]>();
      for (const product of visibleProducts) {
        const products = productGroups.get(product.familyLabel) ?? [];
        products.push(product);
        productGroups.set(product.familyLabel, products);
      }

      return [
        {
          colId: "customer",
          headerName: `${rows.length} orders`,
          pinned: "left",
          lockPinned: true,
          suppressMovable: true,
          width: CUSTOMER_COL_WIDTH,
          minWidth: 180,
          cellRenderer: CustomerCell,
          sortable: true,
          comparator: (_left, _right, leftNode, rightNode) =>
            (leftNode.data?.rowType === "order" ? leftNode.data.order.customerName : "")
              .localeCompare(
                rightNode.data?.rowType === "order"
                  ? rightNode.data.order.customerName
                  : ""
              ),
          getQuickFilterText: () => "",
        },
        {
          colId: "shipDate",
          headerName: "Ship",
          pinned: "left",
          lockPinned: true,
          suppressMovable: true,
          width: SHIP_COL_WIDTH,
          minWidth: 100,
          cellRenderer: ShipCell,
          sortable: true,
          comparator: (_left, _right, leftNode, rightNode) =>
            (leftNode.data?.rowType === "order" ? leftNode.data.order.shipDate ?? "" : "")
              .localeCompare(
                rightNode.data?.rowType === "order"
                  ? rightNode.data.order.shipDate ?? ""
                  : ""
              ),
          getQuickFilterText: () => "",
        },
        ...[...productGroups.entries()].map(
          ([familyLabel, products]): ColGroupDef<SalesAllocationGridRow> => ({
            headerName: familyLabel,
            marryChildren: true,
            children: products.map(
              (product): ColDef<SalesAllocationGridRow> => ({
                colId: productColId(product.itemId),
                headerName: product.variantLabel,
                width: PRODUCT_COL_WIDTH,
                minWidth: 82,
                maxWidth: 180,
                sortable: false,
                suppressMovable: true,
                headerComponent: ProductHeader,
                headerComponentParams: { product, onHide: hideColumn },
                cellRenderer: (params: ICellRendererParams<SalesAllocationGridRow>) => (
                  <AllocationProductCell
                    {...params}
                    product={product}
                    selected={selected}
                    onOpenAllocation={openAllocation}
                  />
                ),
                cellClass: styles.productCell,
                getQuickFilterText: () => "",
              })
            ),
          })
        ),
      ];
    },
    [hideColumn, rows.length, selected, visibleProducts]
  );

  const rowClassRules = useMemo(
    () => ({
      [styles.summaryRow]: (params: RowClassParams<SalesAllocationGridRow>) =>
        params.data?.rowType === "coverage" || params.data?.rowType === "totals",
      [styles.todayRow]: (params: RowClassParams<SalesAllocationGridRow>) =>
        params.data?.rowType === "order" && params.data.isToday,
      [styles.highlightedRow]: (params: RowClassParams<SalesAllocationGridRow>) =>
        params.data?.rowType === "order" && params.data.order.id === highlightedOrderId,
      [styles.completeRow]: (params: RowClassParams<SalesAllocationGridRow>) =>
        params.data?.rowType === "order" && params.data.progress.state === "complete",
      [styles.lateRow]: (params: RowClassParams<SalesAllocationGridRow>) =>
        params.data?.rowType === "order" && params.data.lateDays != null,
    }),
    [highlightedOrderId]
  );

  const bulkActionTitle =
    pendingBulkAction === "allocate_fifo"
      ? "Allocate unallocated orders?"
      : "Unallocate open orders?";
  const bulkActionDescription =
    pendingBulkAction === "allocate_fifo"
      ? "All currently unallocated orders will be attempted to be filled by on-hand stock in FIFO order, based on soonest ship dates for the orders."
      : "This will unallocate all stock for currently open orders.";
  const bulkActionLabel =
    pendingBulkAction === "allocate_fifo" ? "Allocate FIFO" : "Unallocate";

  return (
    <>
      <ERPDataGrid
        rows={gridRows}
        columns={columns}
        pinnedTopRows={pinnedTopRows}
        getRowId={(row) => row.id}
        searchValue={search}
        onSearchChange={setSearch}
        searchAriaLabel="Search sales allocations"
        enableQuickFilter={false}
        emptyMessage="No open sales allocations."
        className={styles.shell}
        height="calc(100dvh - 10.75rem)"
        rowHeight={42}
        headerHeight={54}
        groupHeaderHeight={34}
        columnHoverHighlight
        defaultColDef={{
          resizable: true,
          suppressHeaderMenuButton: true,
        }}
        rowClassRules={rowClassRules}
        onGridReady={(event: GridReadyEvent<SalesAllocationGridRow>) => {
          gridApiRef.current = event.api;
          scrollHighlightedOrderIntoView();
        }}
        onFirstDataRendered={() => {
          scrollHighlightedOrderIntoView();
        }}
        toolbarContent={
          <div className={styles.toolbarLeft}>
            <HugeiconsIcon icon={Search01Icon} className={styles.searchIcon} />
          </div>
        }
        actions={
          <div className={styles.chips}>
            {hiddenProducts.length > 0 ? (
              <HiddenColumnsMenu
                hiddenProducts={hiddenProducts}
                onRestore={restoreColumn}
                onShowAll={showAllColumns}
              />
            ) : null}
            {totals.late > 0 ? (
              <Chip tone="short" label={`${totals.late} late`} />
            ) : null}
            <Chip
              tone="partial"
              label={`${totals.shortLines} short of ${totals.lines} lines`}
            />
            <Chip tone="met" label={`${totals.complete} complete`} />
            <Chip
              tone="neutral"
              label={`${compactQuantity(totals.alloc)} / ${compactQuantity(totals.demand)} allocated`}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={styles.allocateButton}>
                  Allocate / Unallocate
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>Bulk allocation</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => setPendingBulkAction("allocate_fifo")}
                >
                  Allocate unallocated FIFO
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setPendingBulkAction("unallocate_open")}
                >
                  Unallocate open orders
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <AlertDialog
        open={pendingBulkAction != null}
        onOpenChange={(open) => {
          if (!open && !bulkAllocationMutation.isPending) {
            setPendingBulkAction(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bulkActionTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkActionDescription} Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkAllocationMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkAllocationMutation.isPending}
              onClick={() => {
                if (pendingBulkAction) {
                  bulkAllocationMutation.mutate(pendingBulkAction);
                }
              }}
            >
              {bulkAllocationMutation.isPending ? "Working..." : bulkActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AllocationSourceDialog
        target={allocationTarget}
        onOpenChange={(open) => {
          if (!open) setAllocationTarget(null);
        }}
      />
    </>
  );
}
