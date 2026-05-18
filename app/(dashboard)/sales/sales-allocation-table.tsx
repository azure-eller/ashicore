"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ColDef,
  ColGroupDef,
  GridApi,
  GridReadyEvent,
  ICellRendererParams,
  IHeaderGroupParams,
  IHeaderParams,
} from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  LayoutThreeColumnIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
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
  DropdownMenuCheckboxItem,
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
const ORDER_COL_WIDTH = 240;
const SHIP_COL_WIDTH = 96;
const PRODUCT_COL_WIDTH = 112;

const COLLAPSED_WEEKS_KEY = "ashicore.allocation.collapsedWeeks";
const UNPLANNED_OPEN_KEY = "ashicore.allocation.unplannedOpen";
const POOL_REFRESHED_AT_KEY = "ashicore.allocation.poolRefreshedAt";

type RibbonFilter = "late" | "shortLines" | "variantsShort";

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

type CoverageRowData = {
  id: "coverage";
  rowType: "coverage";
  coverageByProductId: Map<string, ColumnCoverage>;
};

type WeekHeaderRowData = {
  id: string;
  rowType: "weekHeader";
  weekKey: string;
  label: string;
  orderCount: number;
  lineCount: number;
  shortCount: number;
  lateCount: number;
};

type UnplannedHeaderRowData = {
  id: "unplanned-header";
  rowType: "unplannedHeader";
  orderCount: number;
};

type OrderGridRow = {
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
  isUnplanned: boolean;
  weekKey: string;
};

type SalesAllocationGridRow =
  | CoverageRowData
  | WeekHeaderRowData
  | UnplannedHeaderRowData
  | OrderGridRow;

type BulkAllocationAction = "allocate_fifo" | "unallocate_open";

// ============================================================================
// Pure helpers
// ============================================================================

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
      const leftIsUnplanned = left.demandTypeLabel === "Unplanned demand";
      const rightIsUnplanned = right.demandTypeLabel === "Unplanned demand";
      if (leftIsUnplanned !== rightIsUnplanned) {
        return leftIsUnplanned ? 1 : -1;
      }
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

function formatShipDateCompact(value: string | null) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
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
        else if (surplus < demand * 0.05) verdict = "tight";
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
  if (cell.alloc >= cell.demand) return "full";
  if (cell.alloc > 0) return "part";
  return "zero";
}

function isoWeekMondayOf(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "no-date";
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  const mondayOffset = (dayOfWeek + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

function weekLabelOf(weekKey: string) {
  if (weekKey === "no-date") return "No ship date";
  const [year, month, day] = weekKey.split("-").map(Number);
  if (!year || !month || !day) return weekKey;
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `Week of ${fmt(start)} – ${fmt(end)}`;
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

function applyRibbonFilter(
  rows: AllocationRow[],
  filter: RibbonFilter | null,
  coverageByProductId: Map<string, ColumnCoverage>
) {
  if (!filter) return rows;
  if (filter === "late") {
    return rows.filter((row) => getRowLateState(row) != null);
  }
  if (filter === "shortLines") {
    return rows.filter((row) =>
      [...row.cells.values()].some((cell) => cell.demand > cell.alloc)
    );
  }
  if (filter === "variantsShort") {
    const shortIds = new Set(
      [...coverageByProductId.entries()]
        .filter(([, coverage]) => coverage.verdict === "short")
        .map(([id]) => id)
    );
    if (shortIds.size === 0) return rows;
    return rows.filter((row) =>
      [...row.cells.values()].some(
        (cell) => shortIds.has(cell.product.itemId) && cell.demand > cell.alloc
      )
    );
  }
  return rows;
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

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors — preference is best-effort
  }
}

function buildGridRows({
  rows,
  coverage,
  collapsedWeeks,
  unplannedOpen,
}: {
  rows: AllocationRow[];
  coverage: Map<string, ColumnCoverage>;
  collapsedWeeks: Set<string>;
  unplannedOpen: boolean;
}): {
  topRows: SalesAllocationGridRow[];
  bodyRows: SalesAllocationGridRow[];
} {
  const topRows: SalesAllocationGridRow[] = [
    { id: "coverage", rowType: "coverage", coverageByProductId: coverage },
  ];

  const orderRows: OrderGridRow[] = rows.map((row) => {
    const isUnplanned = row.demandTypeLabel === "Unplanned demand";
    return {
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
      isUnplanned,
      weekKey: isUnplanned
        ? "unplanned"
        : row.shipDate
          ? isoWeekMondayOf(row.shipDate)
          : "no-date",
    };
  });

  const bodyRows: SalesAllocationGridRow[] = [];

  const planned = orderRows.filter((row) => !row.isUnplanned);
  const unplanned = orderRows.filter((row) => row.isUnplanned);

  const weekBuckets = new Map<string, OrderGridRow[]>();
  const weekOrder: string[] = [];
  planned.forEach((row) => {
    if (!weekBuckets.has(row.weekKey)) {
      weekBuckets.set(row.weekKey, []);
      weekOrder.push(row.weekKey);
    }
    weekBuckets.get(row.weekKey)!.push(row);
  });

  weekOrder.forEach((weekKey) => {
    const ordersInWeek = weekBuckets.get(weekKey) ?? [];
    const lineCount = ordersInWeek.reduce(
      (sum, row) =>
        sum + [...row.cells.values()].filter((cell) => cell.demand > 0).length,
      0
    );
    const shortCount = ordersInWeek.reduce(
      (sum, row) =>
        sum +
        [...row.cells.values()].filter((cell) => cell.demand > cell.alloc).length,
      0
    );
    const lateCount = ordersInWeek.filter((row) => row.lateDays != null).length;

    bodyRows.push({
      id: `week-header:${weekKey}`,
      rowType: "weekHeader",
      weekKey,
      label: weekLabelOf(weekKey),
      orderCount: ordersInWeek.length,
      lineCount,
      shortCount,
      lateCount,
    });

    if (!collapsedWeeks.has(weekKey)) {
      ordersInWeek.forEach((row) => bodyRows.push(row));
    }
  });

  if (unplanned.length > 0) {
    bodyRows.push({
      id: "unplanned-header",
      rowType: "unplannedHeader",
      orderCount: unplanned.length,
    });

    if (unplannedOpen) {
      unplanned.forEach((row) => bodyRows.push(row));
    }
  }

  return { topRows, bodyRows };
}

function formatRefreshedAgo(ms: number | null) {
  if (ms == null) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hr ago";
  if (hours < 24) return `${hours} hr ago`;
  return "stale";
}

function refreshedStaleness(ms: number | null) {
  if (ms == null) return null;
  if (ms > 60 * 60_000) return "danger";
  if (ms > 10 * 60_000) return "warning";
  return null;
}

// ============================================================================
// Cell renderers
// ============================================================================

function FamilyHeader({ displayName }: IHeaderGroupParams) {
  return (
    <div className={styles.familyHeader}>
      <span className={styles.familyHeaderSwatch} aria-hidden="true" />
      <span className={styles.familyHeaderName}>{displayName}</span>
    </div>
  );
}

function VariantHeader({
  product,
  onHide,
}: IHeaderParams & {
  product: AllocationProduct;
  onHide: (productId: string) => void;
}) {
  return (
    <div className={styles.variantHeader}>
      <span className={styles.variantHeaderLabel}>{product.variantLabel}</span>
      <span className={styles.variantHeaderSku}>
        {product.sku ?? product.unitName}
      </span>
      <button
        type="button"
        className={styles.variantHeaderHide}
        aria-label={`Hide ${product.label}`}
        onClick={(event) => {
          event.stopPropagation();
          onHide(product.itemId);
        }}
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
      </button>
    </div>
  );
}

function OrderIdentityCell({
  data,
}: ICellRendererParams<SalesAllocationGridRow>) {
  if (!data) return null;

  if (data.rowType === "coverage") {
    return (
      <div className={styles.coverageIdentityCell}>
        <span className={styles.coverageIdentityTitle}>Pool coverage</span>
        <span className={styles.coverageIdentitySub}>
          On-hand + expected MO
        </span>
      </div>
    );
  }

  if (data.rowType === "weekHeader" || data.rowType === "unplannedHeader") {
    return null;
  }

  return (
    <div className={styles.orderIdentityCell}>
      <span
        className={styles.customerName}
        title={`${data.customerName} · ${data.demandTypeLabel}`}
      >
        {data.customerName}
      </span>
      <Link
        href={`/sales/orders/${data.order.id}`}
        className={styles.orderNumber}
      >
        {data.order.orderNumber}
      </Link>
    </div>
  );
}

function ShipDateCell({ data }: ICellRendererParams<SalesAllocationGridRow>) {
  if (!data) return null;
  if (data.rowType === "coverage") return null;
  if (data.rowType === "weekHeader" || data.rowType === "unplannedHeader") return null;

  const display = formatShipDateCompact(data.shipDate);
  const late = data.lateDays != null;
  const empty = !display;

  return (
    <div className={styles.shipCell}>
      <span
        className={styles.shipDate}
        data-late={late ? "true" : undefined}
        data-empty={empty ? "true" : undefined}
      >
        {empty ? "—" : display}
      </span>
    </div>
  );
}

function CoverageVariantCell({
  data,
  productId,
}: ICellRendererParams<SalesAllocationGridRow> & { productId: string }) {
  if (!data || data.rowType !== "coverage") return null;
  const coverage = data.coverageByProductId.get(productId);
  if (!coverage) return null;

  const tone =
    coverage.verdict === "short"
      ? "short"
      : coverage.verdict === "tight"
        ? "tight"
        : coverage.verdict === "ok"
          ? "ok"
          : "idle";

  const surplusMagnitude = Math.abs(coverage.surplus);
  const deltaText =
    coverage.verdict === "idle"
      ? "—"
      : coverage.verdict === "short"
        ? `−${compactQuantity(surplusMagnitude)}`
        : `+${compactQuantity(surplusMagnitude)}`;

  const meterDenominator = Math.max(coverage.demand, coverage.pool, 1);
  const meterWidth =
    coverage.demand <= 0
      ? 100
      : Math.min(100, (coverage.pool / meterDenominator) * 100);

  const tooltipLabel = `Pool ${compactQuantity(coverage.pool)} = on-hand ${compactQuantity(coverage.stock)} + expected MO ${compactQuantity(coverage.incoming)}.`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={styles.coverageCell}>
          <span className={styles.coverageDelta} data-tone={tone}>
            {deltaText}
          </span>
          <span className={styles.coverageMeter} aria-hidden="true">
            <span
              className={styles.coverageMeterFill}
              data-tone={tone === "idle" ? "ok" : tone}
              style={{ width: `${meterWidth}%` }}
            />
          </span>
          <span className={styles.coverageSub}>
            {compactQuantity(coverage.pool)}
            <span>/</span>
            {compactQuantity(coverage.demand)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
    </Tooltip>
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
  onOpenAllocation: (row: OrderGridRow, cell: AllocationCell) => void;
}) {
  if (!data || data.rowType !== "order") return null;

  const cell = data.cells.get(product.itemId) ?? null;
  const status = getCellStatus(cell);

  if (status === "empty") {
    return <div className={styles.allocationCellEmpty} aria-hidden="true" />;
  }

  const isSelected =
    selected?.rowId === data.id && selected.colId === product.itemId;
  const allocationLabel = cell
    ? `${compactQuantity(cell.alloc)} / ${compactQuantity(cell.demand)}`
    : "0 / 0";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={styles.allocationCell}
          data-selected={isSelected ? "true" : undefined}
          onClick={() => {
            if (cell) onOpenAllocation(data, cell);
          }}
          aria-label={`Allocate ${product.label}`}
        >
          <span
            className={styles.miniSquare}
            data-status={status}
            aria-hidden="true"
          />
          <span className={styles.allocationCellText}>
            <span>{cell ? compactQuantity(cell.alloc) : "0"}</span>
            <span className={styles.allocationCellQty}>
              / {cell ? compactQuantity(cell.demand) : "0"}
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="flex-col items-start gap-(--space-1) whitespace-nowrap px-(--space-4) py-(--space-2)"
      >
        <span className="font-medium">{product.label}</span>
        <span className="font-mono text-muted-foreground">
          {allocationLabel}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function SectionBannerRow({
  data,
  collapsedWeeks,
  unplannedOpen,
  onToggleWeek,
  onToggleUnplanned,
}: {
  data: WeekHeaderRowData | UnplannedHeaderRowData;
  collapsedWeeks: Set<string>;
  unplannedOpen: boolean;
  onToggleWeek: (weekKey: string) => void;
  onToggleUnplanned: () => void;
}) {
  if (data.rowType === "weekHeader") {
    const collapsed = collapsedWeeks.has(data.weekKey);
    return (
      <div className={styles.sectionRow}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={!collapsed}
          aria-controls={`week-section:${data.weekKey}`}
          onClick={() => onToggleWeek(data.weekKey)}
        >
          <HugeiconsIcon
            icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
            className="size-3"
          />
        </button>
        <span className={styles.sectionLabel}>{data.label}</span>
        <span className={styles.sectionCounts}>
          {data.orderCount} orders · {data.lineCount} lines · {data.shortCount} short
        </span>
        {data.lateCount > 0 ? (
          <span className={styles.sectionLate}>{data.lateCount} late</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.sectionRow} data-tone="unplanned">
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={unplannedOpen}
        aria-controls="unplanned-section"
        onClick={onToggleUnplanned}
      >
        <HugeiconsIcon
          icon={unplannedOpen ? ArrowDown01Icon : ArrowRight01Icon}
          className="size-3"
        />
      </button>
      <span className={styles.sectionLabel}>Unplanned demand</span>
      <span className={styles.sectionCounts}>
        {data.orderCount} orders · not yet on a shipment
      </span>
    </div>
  );
}

// ============================================================================
// Page chrome components
// ============================================================================

function AllocationPageHeader({
  orderCount,
  shortLines,
  totalLines,
  onAllocateFifo,
  onUnallocate,
}: {
  orderCount: number;
  shortLines: number;
  totalLines: number;
  onAllocateFifo: () => void;
  onUnallocate: () => void;
}) {
  return (
    <div className={styles.pageHeader}>
      <h1 className={styles.pageTitle}>Sales Allocation</h1>
      <span className={styles.pageSubtitle}>
        Pool vs. demand · <b>{orderCount}</b> orders, <b>{shortLines}</b> short
        of <b>{totalLines}</b> lines
      </span>
      <span className={styles.pageHeaderSpacer} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={styles.toolbarAllocate}>
            Allocate / Unallocate
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Bulk allocation</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onAllocateFifo}>
            Allocate unallocated FIFO
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onUnallocate}>
            Unallocate open orders
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AllocationToolbar({
  search,
  onSearchChange,
  lateCount,
  shortLines,
  totalLines,
  variantsShort,
  activeFilter,
  onToggleFilter,
  refreshedAgoMs,
  hiddenFamilies,
  families,
  onToggleFamily,
  onShowAllFamilies,
  hiddenProducts,
  onRestoreColumn,
  onShowAllColumns,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  lateCount: number;
  shortLines: number;
  totalLines: number;
  variantsShort: number;
  activeFilter: RibbonFilter | null;
  onToggleFilter: (filter: RibbonFilter) => void;
  refreshedAgoMs: number | null;
  hiddenFamilies: Set<string>;
  families: string[];
  onToggleFamily: (family: string) => void;
  onShowAllFamilies: () => void;
  hiddenProducts: AllocationProduct[];
  onRestoreColumn: (productId: string) => void;
  onShowAllColumns: () => void;
}) {
  const refreshedLabel = formatRefreshedAgo(refreshedAgoMs);
  const staleness = refreshedStaleness(refreshedAgoMs);
  const hiddenFamilyCount = hiddenFamilies.size;
  const hiddenProductCount = hiddenProducts.length;
  const visibleFamilyCount = families.length - hiddenFamilyCount;
  const columnsButtonLabel =
    hiddenProductCount > 0
      ? `${visibleFamilyCount} of ${families.length} families · ${hiddenProductCount} hidden`
      : hiddenFamilyCount > 0
        ? `${visibleFamilyCount} of ${families.length} families`
        : `${families.length} families`;
  const hiddenProductsByFamily = hiddenProducts.reduce((groups, product) => {
    const bucket = groups.get(product.familyLabel) ?? [];
    bucket.push(product);
    groups.set(product.familyLabel, bucket);
    return groups;
  }, new Map<string, AllocationProduct[]>());

  return (
    <div className={styles.toolbar}>
      <label className={styles.toolbarSearch}>
        <HugeiconsIcon icon={Search01Icon} className="size-3.5" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search orders, customers, SKU…"
          aria-label="Search sales allocations"
        />
      </label>
      <span className={styles.toolbarDivider} aria-hidden="true" />
      <button
        type="button"
        className={styles.statusStat}
        data-active={activeFilter === "late" ? "true" : undefined}
        onClick={() => onToggleFilter("late")}
        disabled={lateCount === 0}
        aria-pressed={activeFilter === "late"}
      >
        <span className={styles.statusStatSquare} data-tone="late" aria-hidden="true" />
        <b>{lateCount}</b> late
      </button>
      <button
        type="button"
        className={styles.statusStat}
        data-active={activeFilter === "shortLines" ? "true" : undefined}
        onClick={() => onToggleFilter("shortLines")}
        disabled={shortLines === 0}
        aria-pressed={activeFilter === "shortLines"}
      >
        <span className={styles.statusStatSquare} data-tone="short" aria-hidden="true" />
        <b>{shortLines}</b> short of <b>{totalLines}</b>
      </button>
      <button
        type="button"
        className={styles.statusStat}
        data-active={activeFilter === "variantsShort" ? "true" : undefined}
        onClick={() => onToggleFilter("variantsShort")}
        disabled={variantsShort === 0}
        aria-pressed={activeFilter === "variantsShort"}
      >
        <span
          className={styles.statusStatSquare}
          data-tone="variants"
          aria-hidden="true"
        />
        <b>{variantsShort}</b> variants short
      </button>
      <span className={styles.toolbarSpacer} />
      <span
        className={styles.toolbarRefreshed}
        data-stale={staleness ?? undefined}
      >
        Refreshed <b>{refreshedLabel}</b>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={styles.toolbarButton}>
            <HugeiconsIcon icon={LayoutThreeColumnIcon} className="size-3.5" />
            {columnsButtonLabel}
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="flex items-center justify-between px-2 py-1">
            <DropdownMenuLabel className="p-0">Visible families</DropdownMenuLabel>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onShowAllFamilies}
              disabled={hiddenFamilyCount === 0}
            >
              Show all
            </Button>
          </div>
          <DropdownMenuSeparator />
          {families.map((family) => (
            <DropdownMenuCheckboxItem
              key={family}
              checked={!hiddenFamilies.has(family)}
              onCheckedChange={() => onToggleFamily(family)}
              onSelect={(event) => event.preventDefault()}
            >
              {family}
            </DropdownMenuCheckboxItem>
          ))}
          {hiddenProductCount > 0 ? (
            <>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between px-2 py-1">
                <DropdownMenuLabel className="p-0">
                  Hidden columns
                </DropdownMenuLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onShowAllColumns}
                >
                  Show all
                </Button>
              </div>
              {[...hiddenProductsByFamily.entries()].map(([family, products]) => (
                <div key={`hidden:${family}`}>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {family}
                  </DropdownMenuLabel>
                  {products.map((product) => (
                    <DropdownMenuItem
                      key={product.itemId}
                      onClick={() => onRestoreColumn(product.itemId)}
                    >
                      <HugeiconsIcon icon={Tick02Icon} className="size-3" />
                      {product.variantLabel}
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

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
  const [activeFilter, setActiveFilter] = useState<RibbonFilter | null>(null);
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(
    () => new Set(readLocalStorageJson<string[]>(COLLAPSED_WEEKS_KEY, []))
  );
  const [unplannedOpen, setUnplannedOpen] = useState<boolean>(() =>
    readLocalStorageJson<boolean>(UNPLANNED_OPEN_KEY, true)
  );
  const [hiddenFamilies, setHiddenFamilies] = useState<Set<string>>(new Set());
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const { data: orders = initialData, dataUpdatedAt: ordersUpdatedAt } = useQuery({
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
  const { data: allocationPools = [], dataUpdatedAt: poolsUpdatedAt } = useQuery({
    queryKey: ["allocation-pools", poolParams],
    enabled: poolParams.length > 0,
    queryFn: () =>
      apiJson<AllocationPoolRow[]>(`/api/allocation/pools?${poolParams}`, {
        fallbackError: "Failed to fetch allocation pools.",
      }),
    initialData: initialPools,
  });

  useEffect(() => {
    if (poolsUpdatedAt > 0) {
      writeLocalStorageJson(POOL_REFRESHED_AT_KEY, poolsUpdatedAt);
    }
  }, [poolsUpdatedAt]);

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
                  (assignment) =>
                    assignment.demandLabel === reservation.demandLabel
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
      productsWithPools.filter(
        (product) =>
          !hiddenProductIdSet.has(product.itemId) &&
          !hiddenFamilies.has(product.familyLabel)
      ),
    [productsWithPools, hiddenProductIdSet, hiddenFamilies]
  );
  const allRows = useMemo(
    () => buildRows(orders, productsWithPools),
    [orders, productsWithPools]
  );
  const coverageById = useMemo(
    () => getCoverage(visibleProducts, allRows),
    [visibleProducts, allRows]
  );

  // When the user toggles "variants short" we narrow the variant columns to those
  // products whose pool is short, so the matrix focuses on the supply gap.
  const displayedProducts = useMemo(() => {
    if (activeFilter !== "variantsShort") return visibleProducts;
    return visibleProducts.filter(
      (product) => coverageById.get(product.itemId)?.verdict === "short"
    );
  }, [activeFilter, visibleProducts, coverageById]);

  const filteredRows = useMemo(() => {
    const searched = getFilteredRows(allRows, search);
    return applyRibbonFilter(searched, activeFilter, coverageById);
  }, [allRows, search, activeFilter, coverageById]);

  const familiesAll = useMemo(() => {
    const seen = new Set<string>();
    productsWithPools.forEach((product) => seen.add(product.familyLabel));
    return [...seen].sort((left, right) => left.localeCompare(right));
  }, [productsWithPools]);

  const { topRows, bodyRows } = useMemo(
    () =>
      buildGridRows({
        rows: filteredRows,
        coverage: coverageById,
        collapsedWeeks,
        unplannedOpen,
      }),
    [filteredRows, coverageById, collapsedWeeks, unplannedOpen]
  );

  const orderRowCount = filteredRows.length;
  const totals = useMemo(
    () =>
      filteredRows.reduce(
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
      ),
    [filteredRows]
  );
  const variantsShort = useMemo(
    () =>
      [...coverageById.values()].filter((coverage) => coverage.verdict === "short")
        .length,
    [coverageById]
  );

  const refreshedAgoMs = useMemo(() => {
    const persisted = readLocalStorageJson<number | null>(POOL_REFRESHED_AT_KEY, null);
    const seenAt =
      poolsUpdatedAt > 0 ? poolsUpdatedAt : (persisted ?? ordersUpdatedAt);
    if (!seenAt) return null;
    return Math.max(0, nowTick - seenAt);
  }, [nowTick, poolsUpdatedAt, ordersUpdatedAt]);

  const highlightedOrderId = searchParams.get("highlightOrderId");
  const hiddenProducts = allProducts.filter((product) =>
    hiddenProductIdSet.has(product.itemId)
  );

  const hideColumn = useCallback(
    (productId: string) => {
      preferenceMutation.mutate([...new Set([...hiddenProductIds, productId])]);
    },
    [hiddenProductIds, preferenceMutation]
  );

  const restoreColumn = useCallback(
    (productId: string) => {
      preferenceMutation.mutate(hiddenProductIds.filter((id) => id !== productId));
    },
    [hiddenProductIds, preferenceMutation]
  );

  const showAllColumns = useCallback(() => {
    preferenceMutation.mutate([]);
  }, [preferenceMutation]);

  const toggleWeek = useCallback((weekKey: string) => {
    setCollapsedWeeks((previous) => {
      const next = new Set(previous);
      if (next.has(weekKey)) {
        next.delete(weekKey);
      } else {
        next.add(weekKey);
      }
      writeLocalStorageJson(COLLAPSED_WEEKS_KEY, [...next]);
      return next;
    });
  }, []);

  const toggleUnplanned = useCallback(() => {
    setUnplannedOpen((previous) => {
      const next = !previous;
      writeLocalStorageJson(UNPLANNED_OPEN_KEY, next);
      return next;
    });
  }, []);

  const toggleRibbonFilter = useCallback((filter: RibbonFilter) => {
    setActiveFilter((previous) => (previous === filter ? null : filter));
  }, []);

  const toggleFamily = useCallback((family: string) => {
    setHiddenFamilies((previous) => {
      const next = new Set(previous);
      if (next.has(family)) {
        next.delete(family);
      } else {
        next.add(family);
      }
      return next;
    });
  }, []);

  const showAllFamilies = useCallback(() => {
    setHiddenFamilies(new Set());
  }, []);

  const openAllocation = useCallback(
    (row: OrderGridRow, cell: AllocationCell) => {
      setSelected({ rowId: row.id, colId: cell.product.itemId });
      setAllocationTarget({
        order: row.order,
        line: cell.line,
        product: cell.product,
        targetQty: quantityString(cell.demand),
      });
    },
    []
  );

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
  }, [bodyRows.length, scrollHighlightedOrderIntoView]);

  useEffect(() => {
    if (!search.trim()) return;
    const api = gridApiRef.current;
    if (!api) return;

    const productId = getProductColumnToReveal(filteredRows, visibleProducts, search);
    if (!productId) return;

    api.ensureColumnVisible(productColId(productId), "middle");
  }, [filteredRows, search, visibleProducts]);

  const columns = useMemo<
    Array<ColDef<SalesAllocationGridRow> | ColGroupDef<SalesAllocationGridRow>>
  >(
    () => {
      const productGroups = new Map<string, AllocationProduct[]>();
      for (const product of displayedProducts) {
        const products = productGroups.get(product.familyLabel) ?? [];
        products.push(product);
        productGroups.set(product.familyLabel, products);
      }

      return [
        {
          colId: "order",
          headerName: `${orderRowCount} orders`,
          pinned: "left",
          lockPinned: true,
          suppressMovable: true,
          width: ORDER_COL_WIDTH,
          minWidth: 200,
          cellRenderer: OrderIdentityCell,
          sortable: false,
          getQuickFilterText: () => "",
        },
        {
          colId: "shipDate",
          headerName: "Ship",
          pinned: "left",
          lockPinned: true,
          suppressMovable: true,
          width: SHIP_COL_WIDTH,
          minWidth: 88,
          cellRenderer: ShipDateCell,
          sortable: false,
          getQuickFilterText: () => "",
        },
        ...[...productGroups.entries()].map(
          ([familyLabel, products]): ColGroupDef<SalesAllocationGridRow> => ({
            headerName: familyLabel,
            marryChildren: true,
            headerGroupComponent: FamilyHeader,
            children: products.map(
              (product, index): ColDef<SalesAllocationGridRow> => {
                const isFamilyEnd = index === products.length - 1;
                return {
                  colId: productColId(product.itemId),
                  headerName: product.variantLabel,
                  width: PRODUCT_COL_WIDTH,
                  minWidth: 104,
                  maxWidth: 176,
                  sortable: false,
                  suppressMovable: true,
                  headerComponent: VariantHeader,
                  headerComponentParams: { product, onHide: hideColumn },
                  cellRenderer: (
                    params: ICellRendererParams<SalesAllocationGridRow>
                  ) => {
                    if (params.data?.rowType === "coverage") {
                      return (
                        <CoverageVariantCell
                          {...params}
                          productId={product.itemId}
                        />
                      );
                    }
                    return (
                      <AllocationProductCell
                        {...params}
                        product={product}
                        selected={selected}
                        onOpenAllocation={openAllocation}
                      />
                    );
                  },
                  cellClass: isFamilyEnd ? "fam-end" : undefined,
                  headerClass: isFamilyEnd ? "fam-end" : undefined,
                  getQuickFilterText: () => "",
                };
              }
            ),
          })
        ),
      ];
    },
    [hideColumn, openAllocation, orderRowCount, selected, displayedProducts]
  );

  const isFullWidthRow = useCallback(
    (row: SalesAllocationGridRow) =>
      row.rowType === "weekHeader" || row.rowType === "unplannedHeader",
    []
  );

  const fullWidthCellRenderer = useCallback(
    (row: SalesAllocationGridRow): ReactNode => {
      if (row.rowType !== "weekHeader" && row.rowType !== "unplannedHeader") {
        return null;
      }
      return (
        <SectionBannerRow
          data={row}
          collapsedWeeks={collapsedWeeks}
          unplannedOpen={unplannedOpen}
          onToggleWeek={toggleWeek}
          onToggleUnplanned={toggleUnplanned}
        />
      );
    },
    [collapsedWeeks, toggleUnplanned, toggleWeek, unplannedOpen]
  );

  const rowClassRules = useMemo(
    () => ({
      "unplanned-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" && params.data.isUnplanned,
      "late-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" && params.data.lateDays != null,
      "complete-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" &&
        params.data.progress.state === "complete",
      "highlighted-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" &&
        params.data.order.id === highlightedOrderId,
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
      <div className={styles.shell}>
        <AllocationPageHeader
          orderCount={orderRowCount}
          shortLines={totals.shortLines}
          totalLines={totals.lines}
          onAllocateFifo={() => setPendingBulkAction("allocate_fifo")}
          onUnallocate={() => setPendingBulkAction("unallocate_open")}
        />
        <AllocationToolbar
          search={search}
          onSearchChange={setSearch}
          lateCount={totals.late}
          shortLines={totals.shortLines}
          totalLines={totals.lines}
          variantsShort={variantsShort}
          activeFilter={activeFilter}
          onToggleFilter={toggleRibbonFilter}
          refreshedAgoMs={refreshedAgoMs}
          hiddenFamilies={hiddenFamilies}
          families={familiesAll}
          onToggleFamily={toggleFamily}
          onShowAllFamilies={showAllFamilies}
          hiddenProducts={hiddenProducts}
          onRestoreColumn={restoreColumn}
          onShowAllColumns={showAllColumns}
        />
        <div className={styles.gridShell}>
          <ERPDataGrid
            rows={bodyRows}
            columns={columns}
            pinnedTopRows={topRows}
            getRowId={(row) => row.id}
            emptyMessage="No open sales allocations."
            height="calc(100dvh - 14.5rem)"
            rowHeight={45}
            headerHeight={54}
            groupHeaderHeight={28}
            enableQuickFilter={false}
            columnHoverHighlight
            defaultColDef={{
              resizable: true,
              suppressHeaderMenuButton: true,
            }}
            rowClassRules={rowClassRules}
            isFullWidthRow={isFullWidthRow}
            fullWidthCellRenderer={fullWidthCellRenderer}
            getRowHeight={(row) =>
              row.rowType === "weekHeader" || row.rowType === "unplannedHeader"
                ? 36
                : row.rowType === "coverage"
                  ? 56
                  : null
            }
            onGridReady={(event: GridReadyEvent<SalesAllocationGridRow>) => {
              gridApiRef.current = event.api;
              scrollHighlightedOrderIntoView();
            }}
            onFirstDataRendered={() => {
              scrollHighlightedOrderIntoView();
            }}
          />
        </div>
      </div>

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
