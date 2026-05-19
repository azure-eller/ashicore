"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import {
  updateItemCard,
  updateItemCardVariant,
  type ItemCardDto,
  type UpdateItemCardVariantInput,
} from "@/lib/api/clients/item-cards";
import { formatQuantity } from "@/lib/format";
import styles from "@/components/card-page/card-page.module.css";

export type MaterialSupplyDetailsTabProps = {
  card: ItemCardDto;
  focusItemId: string;
};

export function MaterialSupplyDetailsTab({
  card,
  focusItemId,
}: MaterialSupplyDetailsTabProps) {
  const queryClient = useQueryClient();
  const purchaseUnitEnabled = card.family.purchaseUnitDefinitionId != null;
  const [purchaseUnitOn, setPurchaseUnitOn] = useState(purchaseUnitEnabled);

  // Toggle is a one-way OFF switch in v1: turning ON requires a unit picker
  // that isn't built yet (see cleanup doc). When OFF we send nulls to clear
  // the purchase unit + factor; when ON we leave the values alone.
  const disablePurchaseUnit = useMutation({
    mutationKey: ["item-card", focusItemId, "patch", "purchase-unit-off"],
    mutationFn: () =>
      updateItemCard(focusItemId, {
        purchaseUnitDefinitionId: null,
        purchaseToStockFactor: null,
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });

  const variants = card.variants.filter((variant) => variant.deletedAt == null);

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Card defaults</h2>
        <div className="grid gap-(--space-4) md:grid-cols-2">
          <Field>
            <FieldLabel>Default supplier</FieldLabel>
            <Input
              value=""
              placeholder="Pending backend — supplier field not in update schema yet"
              disabled
            />
          </Field>
          <Field>
            <FieldLabel>Supplier currency</FieldLabel>
            <Input value="USD (Base)" disabled />
          </Field>

          <Field className="md:col-span-2">
            <label className="flex items-center gap-(--space-2) text-[length:var(--text-sm)]">
              <Checkbox
                checked={purchaseUnitOn}
                disabled={!purchaseUnitOn}
                title={
                  purchaseUnitOn
                    ? "Click to disable and clear the purchase unit."
                    : "Purchase-unit picker is pending. Once shipped, enable it from here."
                }
                onCheckedChange={(checked) => {
                  if (purchaseUnitOn && checked !== true) {
                    setPurchaseUnitOn(false);
                    disablePurchaseUnit.mutate();
                  }
                }}
              />
              Use a different purchase unit
              {!purchaseUnitOn ? (
                <span className={styles.helper}> · picker pending</span>
              ) : null}
            </label>
          </Field>

          {purchaseUnitOn ? (
            <>
              <Field>
                <FieldLabel>Default purchase unit of measure</FieldLabel>
                <Input
                  value={card.family.purchaseUnitDefinitionId ?? ""}
                  placeholder="Unit picker — pending wire-up"
                  disabled
                />
              </Field>
              <ConversionField
                focusItemId={focusItemId}
                stockUnitName={card.family.unitName ?? ""}
                value={card.family.purchaseToStockFactor}
              />
            </>
          ) : null}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Variants</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Variant</th>
              <th>Supplier item code</th>
              <th className={styles.num}>Lead time (days)</th>
              <th className={styles.num}>MOQ</th>
              <th className={styles.num}>Default purchase price (USD)</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => (
              <tr key={variant.id}>
                <td>{variant.displayName}</td>
                <SupplyEditableTextCell
                  variantId={variant.id}
                  field="supplierItemCode"
                  value={variant.supplierItemCode}
                />
                <SupplyEditableNumberCell
                  variantId={variant.id}
                  field="defaultLeadTimeDays"
                  value={
                    variant.defaultLeadTimeDays != null
                      ? String(variant.defaultLeadTimeDays)
                      : null
                  }
                  integer
                />
                <SupplyEditableNumberCell
                  variantId={variant.id}
                  field="minimumOrderQuantity"
                  value={variant.minimumOrderQuantity}
                />
                <td className={styles.num}>
                  <span className={styles.placeholder}>—</span>
                  {/* TODO(card-dto): default purchase price not in DTO yet. */}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ConversionField({
  focusItemId,
  stockUnitName,
  value,
}: {
  focusItemId: string;
  stockUnitName: string;
  value: string | null;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", focusItemId, "patch", "purchaseToStockFactor"],
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId, { purchaseToStockFactor: next }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card", focusItemId] });
    },
  });

  return (
    <Field>
      <FieldLabel>Unit conversion rate</FieldLabel>
      <div className="flex items-center gap-(--space-2)">
        <span className="text-[length:var(--text-sm)] text-muted-foreground">
          1 purchase unit =
        </span>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            const next = trimmed === "" ? null : trimmed;
            if (next === (value ?? null)) return;
            mutation.mutate(next);
          }}
          inputMode="decimal"
          className="max-w-[8rem]"
        />
        <span className="text-[length:var(--text-sm)] text-muted-foreground">
          {stockUnitName || "stock units"}
        </span>
      </div>
      {value ? (
        <p className="text-[length:var(--text-xs)] text-muted-foreground mt-(--space-1)">
          Current: 1 purchase unit = {formatQuantity(value)} {stockUnitName}
        </p>
      ) : null}
    </Field>
  );
}

function SupplyEditableTextCell({
  variantId,
  field,
  value,
}: {
  variantId: string;
  field: "supplierItemCode";
  value: string | null;
}) {
  const remote = value ?? "";
  const [draft, setDraft] = useState(remote);
  const [lastSyncedRemote, setLastSyncedRemote] = useState(remote);
  if (remote !== lastSyncedRemote) {
    setLastSyncedRemote(remote);
    setDraft(remote);
  }
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", variantId, "patch", field],
    mutationFn: (next: string | null) =>
      updateItemCardVariant(variantId, { [field]: next } satisfies UpdateItemCardVariantInput),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });
  return (
    <td>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          const next = trimmed === "" ? null : trimmed;
          if (next === (value ?? null)) return;
          mutation.mutate(next);
        }}
        placeholder="—"
        aria-invalid={mutation.isError || undefined}
        className={`${styles.cellInput} ${styles.mono}`}
      />
    </td>
  );
}

function SupplyEditableNumberCell({
  variantId,
  field,
  value,
  integer,
}: {
  variantId: string;
  field: "defaultLeadTimeDays" | "minimumOrderQuantity";
  value: string | null;
  integer?: boolean;
}) {
  const remote = value ?? "";
  const [draft, setDraft] = useState(remote);
  const [lastSyncedRemote, setLastSyncedRemote] = useState(remote);
  if (remote !== lastSyncedRemote) {
    setLastSyncedRemote(remote);
    setDraft(remote);
  }
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", variantId, "patch", field],
    mutationFn: (next: string | number | null) => {
      const payload: UpdateItemCardVariantInput =
        field === "defaultLeadTimeDays"
          ? { defaultLeadTimeDays: next == null ? null : Number(next) }
          : { minimumOrderQuantity: next == null ? null : String(next) };
      return updateItemCardVariant(variantId, payload);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });
  return (
    <td className={styles.num}>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed === "") {
            if (value != null) mutation.mutate(null);
            return;
          }
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed) || parsed < 0) {
            setDraft(value ?? "");
            return;
          }
          const next = integer ? Math.trunc(parsed) : trimmed;
          if (String(next) === (value ?? "")) return;
          mutation.mutate(next);
        }}
        placeholder="—"
        inputMode={integer ? "numeric" : "decimal"}
        aria-invalid={mutation.isError || undefined}
        className={`${styles.cellInput} ${styles.mono}`}
        style={{ textAlign: "right" }}
      />
    </td>
  );
}
