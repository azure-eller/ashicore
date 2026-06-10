"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { CardSection } from "@/components/card-page/card-page";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import type { SalesOrderDetail } from "@/lib/sales/types";
import type { SalesOrderDraftController } from "./use-sales-order-draft-controller";
import cardStyles from "@/components/card-page/card-page.module.css";

type ShippingFeePatch = Pick<
  SalesOrderDetail,
  "shippingFeeDescription" | "shippingFeeAmount" | "shippingFeeTaxAmount"
>;

export function ShippingFeeSection({
  order,
  editable,
  controller,
}: {
  order: SalesOrderDetail;
  editable: boolean;
  controller: SalesOrderDraftController;
}) {
  const descriptionId = useId();
  const amountId = useId();
  const taxId = useId();
  const [descriptionEdit, setDescriptionEdit] = useState<InputEdit | null>(null);
  const [amountEdit, setAmountEdit] = useState<InputEdit | null>(null);
  const [taxEdit, setTaxEdit] = useState<InputEdit | null>(null);
  const description = descriptionEdit?.value ?? order.shippingFeeDescription ?? "";
  const amount = amountEdit?.value ?? order.shippingFeeAmount;
  const tax = taxEdit?.value ?? order.shippingFeeTaxAmount;

  const total = Number(amount || 0) + Number(tax || 0);

  const save = (patch: Partial<ShippingFeePatch>) => {
    controller.patchHeader(patch);
  };

  return (
    <CardSection title="Shipping fee">
      <div className={cardStyles.shippingFeeGrid}>
        <label className={cardStyles.shippingFeeField} htmlFor={descriptionId}>
          <span className={cardStyles.formLabel}>Description</span>
          <Input
            id={descriptionId}
            value={description}
            disabled={!editable}
            onChange={(event) => setDescriptionEdit({ value: event.target.value })}
            onBlur={() => {
              const next = description.trim() || null;
              setDescriptionEdit(null);
              if (next === order.shippingFeeDescription) return;
              save({ shippingFeeDescription: next });
            }}
            placeholder="Shipping fee description"
            className={cardStyles.underlineControl}
          />
        </label>
        <label className={cardStyles.shippingFeeField} htmlFor={amountId}>
          <span className={cardStyles.formLabel}>Fee</span>
          <Input
            id={amountId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            disabled={!editable}
            onChange={(event) => setAmountEdit({ value: event.target.value })}
            onBlur={() => {
              const next = normalizeMoneyInput(amount);
              setAmountEdit(null);
              if (next === order.shippingFeeAmount) return;
              save({ shippingFeeAmount: next });
            }}
            placeholder="0.00"
            className={cn(cardStyles.underlineControl, "text-right font-mono")}
          />
        </label>
        <label className={cardStyles.shippingFeeField} htmlFor={taxId}>
          <span className={cardStyles.formLabel}>Tax</span>
          <Input
            id={taxId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={tax}
            disabled={!editable}
            onChange={(event) => setTaxEdit({ value: event.target.value })}
            onBlur={() => {
              const next = normalizeMoneyInput(tax);
              setTaxEdit(null);
              if (next === order.shippingFeeTaxAmount) return;
              save({ shippingFeeTaxAmount: next });
            }}
            placeholder="0.00"
            className={cn(cardStyles.underlineControl, "text-right font-mono")}
          />
        </label>
      </div>
      <div className="mt-(--space-4) flex justify-end gap-(--space-6) text-[length:var(--text-base)] leading-[var(--leading-base)]">
        <span className="text-[var(--color-ink-faint)]">Total shipping fee</span>
        <span className="font-mono font-semibold tabular-nums">
          {formatPrice(String(total)) ?? "$0.00"}
        </span>
      </div>
    </CardSection>
  );
}

type InputEdit = { value: string };

function normalizeMoneyInput(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "0";
}
