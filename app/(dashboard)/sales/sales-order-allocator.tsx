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
import type { SalesOrdersAllocatorPreference } from "@/lib/view-preferences";
import type { SalesOrderListLine } from "./types";
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
};

type CoverageRow = {
  key: string;
  label: string;
  meta: string | null;
  quantity: string;
  tone: "stock" | "expected" | "short";
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

export function AllocationSourceDialog({
  target,
  onOpenChange,
}: {
  target: AllocationTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const rows = target ? segmentRows(target) : [];
  const coveredQty = rows
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
                  <span />
                  <span />
                  <span />
                  <span>This demand</span>
                </div>
                <div className={styles.sourcesRows}>
                  {rows.length === 0 ? (
                    <div className={styles.emptySources}>No coverage.</div>
                  ) : (
                    rows.map((row) => (
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
