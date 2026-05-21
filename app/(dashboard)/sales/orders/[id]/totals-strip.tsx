"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { formatPrice } from "@/lib/format";
import { patchSalesOrderHeader } from "@/lib/api/clients/sales-orders";
import type { SalesOrderDetail } from "@/app/(dashboard)/sales/types";
import type { OrderDraftController } from "./order-draft";
import styles from "./order-card.module.css";

export type TotalsStripProps = {
  order: SalesOrderDetail;
  notesEditable: boolean;
  draft?: OrderDraftController;
};

export function TotalsStrip({ order, notesEditable, draft }: TotalsStripProps) {
  const notesValue = order.notes ?? "";
  const { marginSummary } = order;
  const revenue = parseAmount(marginSummary.productRevenue);
  const cogs = parseAmount(marginSummary.productCogs);
  const shipmentCosts = parseAmount(marginSummary.shipmentCosts);
  const total = (revenue ?? 0) - (cogs ?? 0) - (shipmentCosts ?? 0);
  const marginPct = marginSummary.marginPercent
    ? Number.parseFloat(marginSummary.marginPercent)
    : null;
  const contributionMargin = marginSummary.contributionMargin
    ? Number.parseFloat(marginSummary.contributionMargin)
    : null;

  return (
    <div className={styles.totalsStrip}>
      <div className={styles.totalsLeft}>
        <div className={styles.totalsLeftLabel}>
          Notes
        </div>
        {notesEditable ? (
          <NotesEditor orderId={order.id} initial={notesValue} draft={draft} />
        ) : notesValue ? (
          <div className="whitespace-pre-wrap text-[13px] text-[var(--color-ink)]">
            {notesValue}
          </div>
        ) : (
          <div className="text-[13px] text-[var(--color-muted-2)]">No notes</div>
        )}
      </div>

      <div className={styles.totalsRight}>
        <TotalsRow label="Product revenue" value={formatMoney(revenue)} />
        <TotalsRow
          label={
            <span className="inline-flex items-center gap-1">
              COGS
              {cogs == null ? <CostsEstimateMark /> : null}
            </span>
          }
          value={cogs == null ? "—" : formatMoney(cogs)}
          minusPrefix
        />
        <TotalsRow
          label="Shipment costs"
          value={shipmentCosts == null ? "—" : formatMoney(shipmentCosts)}
          minusPrefix
        />
        <div className={`${styles.totalsRow} ${styles.totalsRule}`}>
          <div className={styles.totalsRowLabel}>Total</div>
          <div className={styles.totalsRowValue}>{formatMoney(total)}</div>
        </div>
        <div className={styles.totalsRow}>
          <div className={styles.totalsRowLabel}>Contribution margin</div>
          <div className={`${styles.totalsRowValue} ${styles.totalsMargin}`}>
            {marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}
            {contributionMargin != null ? (
              <span className={styles.totalsMarginSub}>{formatMoney(contributionMargin)}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TotalsRow({
  label,
  value,
  minusPrefix,
}: {
  label: React.ReactNode;
  value: string;
  minusPrefix?: boolean;
}) {
  return (
    <div className={styles.totalsRow}>
      <div className={styles.totalsRowLabel}>{label}</div>
      <div className={styles.totalsRowValue}>
        {minusPrefix && value !== "—" ? (
          <span className={styles.totalsRowMinusPrefix}>−</span>
        ) : null}
        {value}
      </div>
    </div>
  );
}

function CostsEstimateMark() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          aria-label="COGS not yet realized"
        >
          <HugeiconsIcon icon={HelpCircleIcon} size={12} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        COGS finalizes when each shipment ships and consumes inventory.
      </TooltipContent>
    </Tooltip>
  );
}

function NotesEditor({
  orderId,
  initial,
  draft,
}: {
  orderId: string;
  initial: string;
  draft?: OrderDraftController;
}) {
  const [value, setValue] = useState(initial);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["sales-order", orderId, "patch", "notes"],
    mutationFn: (notes: string | null) => patchSalesOrderHeader(orderId, { notes }),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", orderId], next);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", orderId] });
    },
  });

  return (
    <Textarea
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const trimmed = value.trim();
        const next = trimmed === "" ? null : trimmed;
        if (next === (initial.trim() === "" ? null : initial)) return;
        if (draft) {
          draft.patchHeader({ notes: next });
          return;
        }
        mutation.mutate(next);
      }}
      rows={3}
      className="resize-y min-h-[48px]"
      placeholder="Add notes for the warehouse or customer."
      aria-invalid={mutation.isError || undefined}
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
