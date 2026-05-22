"use client";

import { useCallback, useMemo, useState } from "react";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { EntityCombobox } from "@/components/entity-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardSection } from "@/components/card-page/card-page";
import { CommitInput } from "@/components/card-page/commit-input";
import {
  FixedEditableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { setItemCardFamilyQueryData } from "@/components/card-page/item-card-cache";
import {
  updateItemCard,
  updateItemCardVariant,
  type ItemCardDto,
  type ItemCardVariantDto,
  type UpdateItemCardVariantInput,
} from "@/lib/api/clients/item-cards";
import { formatQuantity } from "@/lib/format";
import type { SupplierOption } from "@/app/(dashboard)/purchasing/types";
import styles from "@/components/card-page/card-page.module.css";

export type MaterialSupplyDetailsTabProps = {
  card: ItemCardDto;
  focusItemId: string;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  supplierOptions: SupplierOption[];
};

export function MaterialSupplyDetailsTab({
  card,
  focusItemId,
  unitOptions,
  supplierOptions,
}: MaterialSupplyDetailsTabProps) {
  const queryClient = useQueryClient();
  const purchaseUnitEnabled = card.family.purchaseUnitDefinitionId != null;
  const [purchaseUnitOn, setPurchaseUnitOn] = useState(purchaseUnitEnabled);

  const disablePurchaseUnit = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId, "purchase-unit-off"),
    mutationFn: () =>
      updateItemCard(focusItemId, {
        purchaseUnitDefinitionId: null,
        purchaseToStockFactor: null,
      }),
    onSuccess: (nextCard) => {
      setItemCardFamilyQueryData(queryClient, focusItemId, nextCard);
    },
  });
  const supplierMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId, "defaultSupplierId"),
    mutationFn: (defaultSupplierId: string | null) =>
      updateItemCard(focusItemId, { defaultSupplierId }),
    onSuccess: (nextCard) => {
      setItemCardFamilyQueryData(queryClient, focusItemId, nextCard);
    },
  });
  const purchaseUnitMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId, "purchaseUnitDefinitionId"),
    mutationFn: (purchaseUnitDefinitionId: string | null) =>
      updateItemCard(focusItemId, { purchaseUnitDefinitionId }),
    onSuccess: (nextCard) => {
      setItemCardFamilyQueryData(queryClient, focusItemId, nextCard);
    },
  });

  const visibleVariants = useMemo(
    () => card.variants.filter((variant) => variant.deletedAt == null),
    [card.variants],
  );

  return (
    <>
      <CardSection title="Card defaults">
        <div className="grid gap-(--space-4) md:grid-cols-2">
          <Field>
            <FieldLabel>Default supplier</FieldLabel>
            <EntityCombobox
              options={supplierOptions}
              value={card.family.defaultSupplierId}
              onValueChange={(value) => supplierMutation.mutate(value)}
              placeholder="Search suppliers..."
              emptyMessage="No suppliers found"
              createLinks={[
                {
                  href: "/purchasing/suppliers/new",
                  label: "Create supplier",
                },
              ]}
              renderSecondary={(supplier) =>
                supplier.code ? (
                  <span className="ml-auto shrink-0 text-[length:var(--text-xs)] text-muted-foreground">
                    {supplier.code}
                  </span>
                ) : null
              }
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
                disabled={disablePurchaseUnit.isPending || purchaseUnitMutation.isPending}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    setPurchaseUnitOn(true);
                    return;
                  }
                  if (purchaseUnitOn) {
                    setPurchaseUnitOn(false);
                    disablePurchaseUnit.mutate();
                  }
                }}
              />
              Use a different purchase unit
            </label>
          </Field>

          {purchaseUnitOn ? (
            <>
              <Field>
                <FieldLabel>Default purchase unit of measure</FieldLabel>
                <Select
                  value={card.family.purchaseUnitDefinitionId ?? ""}
                  onValueChange={(value) => purchaseUnitMutation.mutate(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a purchase unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name} ({unit.size} {unit.uom})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <ConversionField
                focusItemId={focusItemId}
                stockUnitName={card.family.unitName ?? ""}
                value={card.family.purchaseToStockFactor}
              />
            </>
          ) : null}
        </div>
      </CardSection>

      <CardSection title="Variants">
        <SupplyVariantsGrid focusItemId={focusItemId} variants={visibleVariants} />
      </CardSection>
    </>
  );
}

function SupplyVariantsGrid({
  focusItemId,
  variants,
}: {
  focusItemId: string;
  variants: ItemCardVariantDto[];
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ItemCardVariantDto[]>(variants);
  const [lastSynced, setLastSynced] = useState(variants);
  if (lastSynced !== variants) {
    setLastSynced(variants);
    setRows(variants);
  }

  const cellMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId, "supply-variant-cell"),
    mutationFn: ({
      variantId,
      payload,
    }: {
      variantId: string;
      payload: UpdateItemCardVariantInput;
    }) => updateItemCardVariant(variantId, payload),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });

  const handleRowsChange = useCallback(
    (next: ItemCardVariantDto[], change: EditableLineDataGridChange<ItemCardVariantDto>) => {
      setRows(next);
      if (change.type !== "cell_edit_committed" || !change.row || !change.field) return;
      const raw = change.newValue;
      const blank = raw == null || raw === "";
      const payload: UpdateItemCardVariantInput | null = (() => {
        switch (change.field) {
          case "supplierItemCode":
            return {
              supplierItemCode: blank ? null : String(raw).trim() || null,
            };
          case "defaultLeadTimeDays": {
            if (blank) return { defaultLeadTimeDays: null };
            const parsed = Number(raw);
            if (!Number.isFinite(parsed) || parsed < 0) return null;
            return { defaultLeadTimeDays: Math.trunc(parsed) };
          }
          case "minimumOrderQuantity": {
            if (blank) return { minimumOrderQuantity: null };
            const parsed = Number(raw);
            if (!Number.isFinite(parsed) || parsed <= 0) return null;
            return { minimumOrderQuantity: String(raw).trim() };
          }
          default:
            return null;
        }
      })();
      if (!payload) return;
      cellMutation.mutate({ variantId: change.row.id, payload });
    },
    [cellMutation],
  );

  const columns = useMemo<LineField<ItemCardVariantDto>[]>(
    () => [
      {
        colId: "variant",
        kind: "display",
        headerName: "Variant",
        flex: 1.4,
        minWidth: 200,
        cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) =>
          params.data?.displayName ?? "",
        valueGetter: (params) => params.data?.displayName ?? "",
      },
      {
        field: "supplierItemCode",
        kind: "text",
        headerName: "Supplier item code",
        editable: true,
        cellClass: styles.mono,
        flex: 1,
        minWidth: 140,
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          const trimmed =
            typeof params.newValue === "string"
              ? params.newValue.trim() || null
              : params.newValue;
          if (params.data.supplierItemCode === trimmed) return false;
          params.data.supplierItemCode = (trimmed as string | null) ?? null;
          return true;
        },
      },
      {
        field: "defaultLeadTimeDays",
        kind: "number",
        headerName: "Lead time (days)",
        rightAligned: true,
        editable: true,
        cellClass: styles.mono,
        flex: 0.7,
        minWidth: 120,
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          const raw = params.newValue;
          if (raw === "" || raw == null) {
            if (params.data.defaultLeadTimeDays == null) return false;
            params.data.defaultLeadTimeDays = null;
            return true;
          }
          const parsed = Number(raw);
          if (!Number.isFinite(parsed) || parsed < 0) return false;
          const truncated = Math.trunc(parsed);
          if (params.data.defaultLeadTimeDays === truncated) return false;
          params.data.defaultLeadTimeDays = truncated;
          return true;
        },
      },
      {
        field: "minimumOrderQuantity",
        kind: "number",
        headerName: "MOQ",
        rightAligned: true,
        editable: true,
        cellClass: styles.mono,
        flex: 0.6,
        minWidth: 100,
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          const raw = params.newValue;
          if (raw === "" || raw == null) {
            if (params.data.minimumOrderQuantity == null) return false;
            params.data.minimumOrderQuantity = null;
            return true;
          }
          const trimmed = String(raw).trim();
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed) || parsed <= 0) return false;
          if (params.data.minimumOrderQuantity === trimmed) return false;
          params.data.minimumOrderQuantity = trimmed;
          return true;
        },
      },
      {
        colId: "defaultPurchasePrice",
        kind: "display",
        headerName: "Default purchase price (USD)",
        rightAligned: true,
        flex: 0.9,
        minWidth: 160,
        cellRenderer: () => <span className={styles.placeholder}>—</span>,
      },
    ],
    [],
  );

  return (
    <FixedEditableLines<ItemCardVariantDto>
      rows={rows}
      fields={columns}
      getRowId={(row) => row.id}
      createRow={() => ({ ...rows[0]! })}
      onRowsChange={handleRowsChange}
      emptyMessage="No variants yet."
    />
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
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId, "purchaseToStockFactor"),
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId, { purchaseToStockFactor: next }),
    onSuccess: (nextCard) => {
      setItemCardFamilyQueryData(queryClient, focusItemId, nextCard);
    },
  });

  return (
    <Field>
      <FieldLabel>Unit conversion rate</FieldLabel>
      <div className="flex items-center gap-(--space-2)">
        <span className="text-[length:var(--text-sm)] text-muted-foreground">
          1 purchase unit =
        </span>
        <CommitInput
          label="Unit conversion rate"
          value={value}
          inputMode="decimal"
          className="max-w-[8rem]"
          onCommit={(next) => {
            if (next === (value ?? null)) return;
            mutation.mutate(next);
          }}
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
