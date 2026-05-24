"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { TotalsSummary } from "@/components/card-page/totals-summary";
import { formatPrice } from "@/lib/format";
import type { SalesOrderDetail } from "@/app/(dashboard)/sales/types";
import type { SalesOrderDraftController } from "./use-sales-order-draft-controller";
import styles from "./order-card.module.css";

export type TotalsStripProps = {
  order: SalesOrderDetail;
  notesEditable: boolean;
  controller: SalesOrderDraftController;
};

export function TotalsStrip({ order, notesEditable, controller }: TotalsStripProps) {
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
          { label: "Product revenue", value: formatMoney(revenue) },
          {
            label: (
              <span className="inline-flex items-center gap-1">
                COGS
                {cogs == null ? <CostsEstimateMark /> : null}
              </span>
            ),
            value: cogs == null ? "—" : formatMoney(cogs),
            minusPrefix: true,
          },
          {
            label: "Shipping costs",
            value: shipmentCosts == null ? "—" : formatMoney(shipmentCosts),
            minusPrefix: true,
          },
          {
            label: "Total",
            value: formatMoney(total),
            rule: true,
            emphasis: "total",
          },
          {
            label: "Contribution margin",
            value: marginPct != null ? `${marginPct.toFixed(1)}%` : "—",
            subValue: contributionMargin != null ? formatMoney(contributionMargin) : null,
            emphasis: "success",
          },
        ]}
      />
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
        COGS finalizes when the order ships and consumes inventory.
      </TooltipContent>
    </Tooltip>
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
