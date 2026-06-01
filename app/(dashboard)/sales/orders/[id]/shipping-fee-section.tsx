"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { CardSection } from "@/components/card-page/card-page";
import {
  FramedTable,
  FramedTableCell,
  FramedTableHead,
  FramedTableHeaderCell,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import { formatPrice } from "@/lib/format";
import type { SalesOrderDetail } from "@/app/(dashboard)/sales/types";
import type { SalesOrderDraftController } from "./use-sales-order-draft-controller";

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
      <TableFrame>
        <FramedTable>
          <FramedTableHead>
            <FramedTableRow>
              <FramedTableHeaderCell>Description</FramedTableHeaderCell>
              <FramedTableHeaderCell className="w-40">Cost</FramedTableHeaderCell>
              <FramedTableHeaderCell className="w-40">Tax</FramedTableHeaderCell>
            </FramedTableRow>
          </FramedTableHead>
          <tbody>
            <FramedTableRow>
              <FramedTableCell>
                <Input
                  value={description}
                  disabled={!editable}
                  onChange={(event) => setDescriptionEdit({ value: event.target.value })}
                  onBlur={() => {
                    const next = description.trim() || null;
                    setDescriptionEdit(null);
                    if (next === order.shippingFeeDescription) return;
                    save({ shippingFeeDescription: next });
                  }}
                  placeholder="Shipping fee"
                />
              </FramedTableCell>
              <FramedTableCell>
                <Input
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
                  className="text-right font-mono"
                />
              </FramedTableCell>
              <FramedTableCell>
                <Input
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
                  className="text-right font-mono"
                />
              </FramedTableCell>
            </FramedTableRow>
          </tbody>
        </FramedTable>
      </TableFrame>
      <div className="mt-(--space-4) flex justify-end gap-(--space-6) text-[length:var(--text-base)] leading-[var(--leading-base)]">
        <span className="text-muted-foreground">Total shipping fee</span>
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
