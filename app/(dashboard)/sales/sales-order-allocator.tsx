"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatQuantity, parseQuantity } from "@/lib/format";
import type {
  DemandQueueCoverageSegment,
  DemandQueueSupplySource,
} from "@/lib/inventory/allocation/demand-queue";
import type { SalesOrdersAllocatorPreference } from "@/lib/view-preferences";
import type { SalesOrderListLine } from "@/lib/sales/types";
import styles from "./sales-order-allocator.module.css";

export const SALES_ORDERS_ALLOCATOR_VIEW_KEY = "sales.orders.allocator";

export type AllocatorPreference = SalesOrdersAllocatorPreference;

export type AllocatorProduct = {
  itemId: string;
  label: string;
  familyLabel: string;
  variantLabel: string;
  sku: string | null;
  unitName: string;
};

export type AllocationTarget = {
  demandLabel: string;
  demandContext: string;
  line: SalesOrderListLine & { id: string };
  product: AllocatorProduct;
  targetQty: string;
  sources: DemandQueueSupplySource[];
};

type CoverageRow = {
  key: string;
  label: string;
  meta: string | null;
  quantity: string;
  tone: "stock" | "expected" | "short";
};

type SourceDialogRow = DemandQueueSupplySource & {
  key: string;
  thisDemandQty: string;
};

export function productLabel(line: SalesOrderListLine) {
  return line.attrs.length > 0
    ? `${line.masterName} ${line.attrs.join(" ")}`
    : line.masterName;
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function segmentRows(target: AllocationTarget): CoverageRow[] {
  const rows: CoverageRow[] = [];

  target.line.demandQueueSegments?.forEach((segment, index) => {
    const qty = parseQuantity(segment.qty);
    if (qty <= 0) return;

    if (segment.kind === "in_stock") {
      rows.push({
        key: `${segment.kind}:${index}`,
        label: "On hand",
        meta: "Demand queue coverage",
        quantity: segment.qty,
        tone: "stock",
      });
      return;
    }

    if (segment.kind === "expected") {
      rows.push({
        key: `${segment.kind}:${index}`,
        label: "Expected supply",
        meta: segment.availableDate ? `Expected ${formatDate(segment.availableDate)}` : null,
        quantity: segment.qty,
        tone: "expected",
      });
      return;
    }

    rows.push({
      key: `${segment.kind}:${index}`,
      label: "Short",
      meta: "Not covered by current demand queue supply",
      quantity: segment.qty,
      tone: "short",
    });
  });

  if (rows.length > 0) return rows;

  const inStockQty = parseQuantity(target.line.demandQueueInStockQty);
  const expectedQty = parseQuantity(target.line.demandQueueExpectedQty);
  const shortQty = parseQuantity(target.line.demandQueueShortQty);
  const fallbackRows: CoverageRow[] = [];
  if (inStockQty > 0) {
    fallbackRows.push({
      key: "in-stock",
      label: "On hand",
      meta: "Demand queue coverage",
      quantity: quantityString(inStockQty),
      tone: "stock",
    });
  }
  if (expectedQty > 0) {
    fallbackRows.push({
      key: "expected",
      label: "Expected supply",
      meta: target.line.demandQueueExpectedDate
        ? `Expected ${formatDate(target.line.demandQueueExpectedDate)}`
        : null,
      quantity: quantityString(expectedQty),
      tone: "expected",
    });
  }
  if (shortQty > 0) {
    fallbackRows.push({
      key: "short",
      label: "Short",
      meta: "Not covered by current demand queue supply",
      quantity: quantityString(shortQty),
      tone: "short",
    });
  }
  return fallbackRows;
}

function sourceKey(sourceType: string | undefined, sourceId: string | undefined) {
  return sourceType && sourceId ? `${sourceType}:${sourceId}` : null;
}

function segmentSourceKey(segment: DemandQueueCoverageSegment) {
  if (segment.kind === "short") return null;
  return sourceKey(segment.sourceType, segment.sourceId);
}

function sourceRows(target: AllocationTarget): SourceDialogRow[] {
  const thisDemandQtyBySource = new Map<string, number>();
  for (const segment of target.line.demandQueueSegments ?? []) {
    const key = segmentSourceKey(segment);
    if (!key) continue;
    thisDemandQtyBySource.set(
      key,
      (thisDemandQtyBySource.get(key) ?? 0) + parseQuantity(segment.qty)
    );
  }

  return target.sources.map((source) => {
    const key = sourceKey(source.sourceType, source.sourceId) ?? source.sourceId;
    return {
      ...source,
      key,
      thisDemandQty: quantityString(thisDemandQtyBySource.get(key) ?? 0),
    };
  });
}

function sourceDateLabel(source: DemandQueueSupplySource) {
  if (!source.date) return null;
  const date = source.date.includes("T") ? source.date.slice(0, 10) : source.date;
  if (source.sourceType === "inventory_lot") return `Received ${formatDate(date)}`;
  if (source.sourceType === "manufacturing_order") return `Expected ${formatDate(date)}`;
  return `Expected ${formatDate(date)}`;
}

function sourceBadgeLabel(source: DemandQueueSupplySource) {
  if (source.sourceType === "manufacturing_order") return "MO";
  if (source.sourceType === "purchase_order_line") return "PO";
  return "LOT";
}

function sourceBadgeType(source: DemandQueueSupplySource) {
  return source.sourceType === "manufacturing_order" ? "manufacturing_order" : "inventory_lot";
}

function claimLabel(claim: DemandQueueSupplySource["claims"][number]) {
  const context = claim.contextLabel ? ` · ${claim.contextLabel}` : "";
  const date = claim.requiredDate ? ` · ${formatDate(claim.requiredDate)}` : "";
  return `${claim.label}${context}${date}`;
}

export function AllocationSourceDialog({
  target,
  onOpenChange,
}: {
  target: AllocationTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const rows = target
    ? target.sources.length > 0
      ? sourceRows(target)
      : segmentRows(target)
    : [];
  const sourceDetailRows = target && target.sources.length > 0 ? sourceRows(target) : [];
  const coverageRows = target && target.sources.length === 0 ? segmentRows(target) : [];
  const coveredQty = (target ? segmentRows(target) : [])
    .filter((row) => row.tone !== "short")
    .reduce((sum, row) => sum + parseQuantity(row.quantity), 0);
  const targetQty = parseQuantity(target?.targetQty);
  const remainingToAssign = Math.max(0, targetQty - coveredQty);
  const progressTone = coveredQty >= targetQty && targetQty > 0 ? "met" : "neutral";
  const statusTone = remainingToAssign > 0.0001 ? "short" : "met";

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent size="content" className={styles.sourceDialog}>
        <DialogHeader>
          <DialogTitle>Allocation sources {target?.product.label}</DialogTitle>
          <DialogDescription>
            {target ? `${target.demandLabel} · ${target.demandContext}` : ""}
          </DialogDescription>
        </DialogHeader>

        {target ? (
          <>
            <div className={styles.modalBody}>
              <div className={styles.demandStrip}>
                <div className={styles.demandNeed}>
                  <span>Need</span>
                  <strong>{formatQuantity(target.line.remainingQty ?? "0")}</strong>
                  <span>{target.line.unitName}</span>
                  {target.line.pickedQty ? (
                    <em>Picked {formatQuantity(target.line.pickedQty)}</em>
                  ) : null}
                </div>
                <div className={styles.demandTrack}>
                  <span
                    className={styles.demandFill}
                    data-tone={progressTone}
                    style={{
                      width: `${targetQty > 0 ? Math.min(100, (coveredQty / targetQty) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className={styles.demandStatus} data-tone={statusTone}>
                  <span>Covered</span>
                  <strong>{formatQuantity(quantityString(coveredQty))}</strong>
                  {remainingToAssign > 0.0001 ? (
                    <em>-{formatQuantity(quantityString(remainingToAssign))} short</em>
                  ) : (
                    <em>complete</em>
                  )}
                </div>
              </div>

              <div className={styles.sourcesToolbar}>
                <h3>Sources</h3>
              </div>

              <div className={styles.sourcesTable}>
                <div className={styles.sourcesHeader}>
                  <span>Source</span>
                  <span>Total</span>
                  <span>Claimed</span>
                  <span>Open</span>
                  <span>This demand</span>
                </div>
                <div className={styles.sourcesRows}>
                  {rows.length === 0 ? (
                    <div className={styles.emptySources}>No coverage.</div>
                  ) : sourceDetailRows.length > 0 ? (
                    sourceDetailRows.map((row) => (
                      <div
                        key={row.key}
                        className={styles.sourceRow}
                        data-selected={parseQuantity(row.thisDemandQty) > 0}
                      >
                        <div className={styles.sourceCell}>
                          <span
                            className={styles.sourceBadge}
                            data-type={sourceBadgeType(row)}
                          >
                            {sourceBadgeLabel(row)}
                          </span>
                          <div className={styles.sourceIdentity}>
                            <span className={styles.sourceId}>
                              {row.label ?? row.sourceId}
                            </span>
                            {sourceDateLabel(row) ? (
                              <span className={styles.sourceMeta}>
                                {sourceDateLabel(row)}
                              </span>
                            ) : null}
                            {row.claims.length > 0 ? (
                              <div className={styles.sourceClaims}>
                                {row.claims.map((claim) => (
                                  <span key={`${claim.demandType}:${claim.demandId}`}>
                                    {formatQuantity(claim.qty)} {claimLabel(claim)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className={styles.sourceNumber}>
                          {formatQuantity(row.totalQty)}
                        </div>
                        <div className={styles.sourceNumber}>
                          {formatQuantity(row.claimedQty)}
                        </div>
                        <div className={styles.sourceNumber}>
                          {formatQuantity(row.availableQty)}
                        </div>
                        <div className={styles.allocateCell}>
                          <span className={styles.sourceInput}>
                            {formatQuantity(row.thisDemandQty)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    coverageRows.map((row) => (
                      <div
                        key={row.key}
                        className={styles.sourceRow}
                        data-selected={row.tone !== "short"}
                      >
                        <div className={styles.sourceCell}>
                          <span
                            className={styles.sourceBadge}
                            data-type={row.tone === "expected" ? "manufacturing_order" : "inventory_lot"}
                          >
                            {row.tone === "expected" ? "ETA" : row.tone === "short" ? "SHORT" : "STK"}
                          </span>
                          <div className={styles.sourceIdentity}>
                            <span className={styles.sourceId}>{row.label}</span>
                            {row.meta ? (
                              <span className={styles.sourceMeta}>{row.meta}</span>
                            ) : null}
                          </div>
                        </div>
                        <div />
                        <div />
                        <div />
                        <div className={styles.allocateCell}>
                          <span className={styles.sourceInput}>
                            {formatQuantity(row.quantity)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className={styles.sourceFooter}>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
