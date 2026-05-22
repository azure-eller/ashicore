"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { CardSection } from "@/components/card-page/card-page";
import { useEntityFieldCommit } from "@/components/card-page/use-entity-field-commit";
import { patchSalesOrderHeader } from "@/lib/api/clients/sales-orders";
import { formatPrice } from "@/lib/format";
import type { SalesOrderDetail } from "@/app/(dashboard)/sales/types";
import type { OrderDraftController } from "./order-draft";

type ShippingFeePatch = Pick<
  SalesOrderDetail,
  "shippingFeeDescription" | "shippingFeeAmount" | "shippingFeeTaxAmount"
>;

export function ShippingFeeSection({
  order,
  editable,
  draft,
}: {
  order: SalesOrderDetail;
  editable: boolean;
  draft?: OrderDraftController;
}) {
  const [description, setDescription] = useState(order.shippingFeeDescription ?? "");
  const [amount, setAmount] = useState(order.shippingFeeAmount);
  const [tax, setTax] = useState(order.shippingFeeTaxAmount);

  const commit = useEntityFieldCommit<Partial<ShippingFeePatch>, SalesOrderDetail>({
    entityKey: "sales-order",
    entityId: order.id,
    scope: "shipping-fee",
    mutationFn: (patch) => patchSalesOrderHeader(order.id, patch),
    setQueryDataKey: ["sales-order", order.id],
    optimisticUpdate: (current, patch) =>
      current ? ({ ...current, ...patch } as SalesOrderDetail) : current,
    invalidateQueryKeys: [["sales-orders"]],
  });

  const total = Number(amount || 0) + Number(tax || 0);

  const save = (patch: Partial<ShippingFeePatch>) => {
    if (draft) {
      draft.patchHeader(patch);
      return;
    }
    commit(patch);
  };

  return (
    <CardSection title="Shipping fee">
      <div className="overflow-hidden border border-[var(--color-line)]">
        <div className="grid grid-cols-[1fr_160px_160px] bg-[var(--color-surface-alt)] text-[length:var(--text-xs)] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <div className="border-r border-[var(--color-line)] px-(--space-4) py-(--space-3)">
            Description
          </div>
          <div className="border-r border-[var(--color-line)] px-(--space-4) py-(--space-3)">
            Cost
          </div>
          <div className="px-(--space-4) py-(--space-3)">Tax</div>
        </div>
        <div className="grid grid-cols-[1fr_160px_160px]">
          <div className="border-r border-[var(--color-line)] p-(--space-3)">
            <Input
              value={description}
              disabled={!editable}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => {
                const next = description.trim() || null;
                if (next === order.shippingFeeDescription) return;
                save({ shippingFeeDescription: next });
              }}
              placeholder="Shipping fee"
            />
          </div>
          <div className="border-r border-[var(--color-line)] p-(--space-3)">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              disabled={!editable}
              onChange={(event) => setAmount(event.target.value)}
              onBlur={() => {
                const next = normalizeMoneyInput(amount);
                setAmount(next);
                if (next === order.shippingFeeAmount) return;
                save({ shippingFeeAmount: next });
              }}
              className="text-right font-mono"
            />
          </div>
          <div className="p-(--space-3)">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={tax}
              disabled={!editable}
              onChange={(event) => setTax(event.target.value)}
              onBlur={() => {
                const next = normalizeMoneyInput(tax);
                setTax(next);
                if (next === order.shippingFeeTaxAmount) return;
                save({ shippingFeeTaxAmount: next });
              }}
              className="text-right font-mono"
            />
          </div>
        </div>
      </div>
      <div className="mt-(--space-4) flex justify-end gap-(--space-6) text-[length:var(--text-sm)]">
        <span className="text-muted-foreground">Total shipping fee</span>
        <span className="font-mono font-semibold tabular-nums">
          {formatPrice(String(total)) ?? "$0.00"}
        </span>
      </div>
    </CardSection>
  );
}

function normalizeMoneyInput(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "0";
}
