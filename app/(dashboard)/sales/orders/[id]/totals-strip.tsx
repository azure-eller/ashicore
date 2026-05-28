"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { TotalsSummary } from "@/components/card-page/totals-summary";
import { formatPrice } from "@/lib/format";
import { displaySalesOrderNotes } from "@/lib/sales/import-notes";
import type {
  SalesOrderDetail,
  SalesOrderItemOption,
} from "@/app/(dashboard)/sales/types";
import type { SalesOrderDraftController } from "./use-sales-order-draft-controller";
import styles from "./order-card.module.css";

export type TotalsStripProps = {
  order: SalesOrderDetail;
  itemOptions: SalesOrderItemOption[];
  notesEditable: boolean;
  controller: SalesOrderDraftController;
};

export function TotalsStrip({
  order,
  itemOptions,
  notesEditable,
  controller,
}: TotalsStripProps) {
  const notesValue = displaySalesOrderNotes(order.notes) ?? "";
  const { marginSummary } = order;
  const itemMap = new Map(itemOptions.map((item) => [item.id, item]));
  const revenue = parseAmount(marginSummary.productRevenue);
  const discount = calculateDiscountAmount(order, itemMap);
  const grossRevenue = revenue == null ? null : revenue + discount;
  const shippingFee = parseAmount(order.shippingFeeAmount) ?? 0;
  const taxAmount = parseAmount(order.taxAmount) ?? 0;
  const total = parseAmount(order.totalAmount);

  return (
    <div className={styles.totalsStrip}>
      <div className={styles.totalsLeft}>
        <div className={styles.totalsLeftLabel}>
          Notes
        </div>
        {notesEditable ? (
          <NotesEditor initial={notesValue} controller={controller} />
        ) : notesValue ? (
          <div className="whitespace-pre-wrap text-[13px] text-[var(--color-ink)]">
            {notesValue}
          </div>
        ) : (
          <div className="text-[13px] text-[var(--color-muted-2)]">No notes</div>
        )}
      </div>

      <TotalsSummary
        className={styles.totalsRight}
        rows={[
          { label: "Product revenue", value: formatMoney(grossRevenue) },
          {
            label: "Discount",
            value: formatMoney(discount),
            minusPrefix: !isZeroAmount(discount),
          },
          {
            label: "Shipping fee",
            value: formatMoney(shippingFee),
          },
          {
            label: "Tax",
            value: formatMoney(taxAmount),
          },
          {
            label: "Total",
            value: formatMoney(total),
            rule: true,
            emphasis: "total",
          },
        ]}
      />
    </div>
  );
}

function NotesEditor({
  initial,
  controller,
}: {
  initial: string;
  controller: SalesOrderDraftController;
}) {
  const [edit, setEdit] = useState<{ value: string } | null>(null);
  const value = edit?.value ?? initial;

  return (
    <Textarea
      value={value}
      onChange={(event) => setEdit({ value: event.target.value })}
      onBlur={() => {
        const trimmed = value.trim();
        const next = trimmed === "" ? null : trimmed;
        setEdit(null);
        if (next === (initial.trim() === "" ? null : initial)) return;
        controller.patchHeader({ notes: next });
      }}
      rows={3}
      className="resize-y min-h-[48px]"
      placeholder="Add notes for the warehouse or customer."
    />
  );
}

function parseAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: number | string | null | undefined): string {
  if (value == null) return "—";
  return formatPrice(String(value)) ?? "—";
}

function isZeroAmount(value: number | null | undefined) {
  return value === 0;
}

function calculateDiscountAmount(
  order: SalesOrderDetail,
  itemMap: Map<string, SalesOrderItemOption>,
) {
  return order.lines.reduce((total, line) => {
    const baseUnitPrice = itemMap.get(line.itemId)?.defaultSellingPrice;
    const base = baseUnitPrice == null ? NaN : Number(baseUnitPrice);
    const unitPrice = Number(line.unitPrice);
    const quantity = Number(
      order.status === "done" ? line.shippedQuantity : line.quantity
    );
    if (
      !Number.isFinite(base) ||
      !Number.isFinite(unitPrice) ||
      !Number.isFinite(quantity) ||
      base <= unitPrice
    ) {
      return total;
    }
    return total + (base - unitPrice) * quantity;
  }, 0);
}
