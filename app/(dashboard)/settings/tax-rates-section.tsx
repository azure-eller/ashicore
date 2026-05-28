"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsPanel, SettingsPanelHeader } from "./settings-panel";

type TaxRateRow = {
  id: string;
  ratePercent: string;
  name: string;
};

export type TaxRatesSectionData = {
  rates: TaxRateRow[];
  defaultSalesTaxRateId: string | null;
  defaultPurchaseTaxRateId: string | null;
};

const NO_TAX_VALUE = "none";

export function TaxRatesSection({ initialData }: { initialData: TaxRatesSectionData }) {
  const [rates, setRates] = useState<TaxRateRow[]>(initialData.rates);
  const [defaultSalesTaxRateId, setDefaultSalesTaxRateId] = useState(
    initialData.defaultSalesTaxRateId,
  );
  const [defaultPurchaseTaxRateId, setDefaultPurchaseTaxRateId] = useState(
    initialData.defaultPurchaseTaxRateId,
  );
  const didMountRef = useRef(false);

  const mutation = useMutation({
    mutationFn: async (data: TaxRatesSectionData) => {
      const response = await fetch("/api/tax-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw await response.json();
      return (await response.json()) as TaxRatesSectionData;
    },
  });
  const saveTaxSettings = mutation.mutate;

  const fields = useMemo<LineField<TaxRateRow>[]>(
    () => [
      {
        field: "ratePercent",
        kind: "number",
        headerName: "Rate",
        width: 170,
        rightAligned: true,
        editable: true,
        getSuffix: () => "%",
        valueFormatter: ({ value }) => `${value ?? "0"} %`,
      },
      {
        field: "name",
        kind: "text",
        headerName: "Name",
        flex: 1,
        minWidth: 240,
        editable: true,
      },
    ],
    [],
  );

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    const handle = window.setTimeout(() => {
      const cleanRates = rates
        .map((rate) => ({
          ...rate,
          name: rate.name.trim(),
          ratePercent: rate.ratePercent.trim() || "0",
        }))
        .filter((rate) => rate.name.length > 0);
      saveTaxSettings({
        rates: cleanRates,
        defaultSalesTaxRateId:
          defaultSalesTaxRateId &&
          cleanRates.some((rate) => rate.id === defaultSalesTaxRateId)
            ? defaultSalesTaxRateId
            : null,
        defaultPurchaseTaxRateId:
          defaultPurchaseTaxRateId &&
          cleanRates.some((rate) => rate.id === defaultPurchaseTaxRateId)
            ? defaultPurchaseTaxRateId
            : null,
      });
    }, 500);

    return () => window.clearTimeout(handle);
  }, [defaultPurchaseTaxRateId, defaultSalesTaxRateId, rates, saveTaxSettings]);

  const options = rates.filter((rate) => rate.name.trim().length > 0);
  const saveStatus = mutation.isPending
    ? "Saving…"
    : mutation.isError
      ? "Changes not saved"
      : "All changes saved";

  return (
    <SettingsPanel id="tax-rates">
      <SettingsPanelHeader
        title="Tax rates"
        meta="Applied to sales and purchase order items to calculate tax totals."
        action={
          <span className="text-[length:var(--text-xs)] text-muted-foreground">
            {saveStatus}
          </span>
        }
      />

      <div className="grid gap-(--space-12) p-(--space-8) lg:grid-cols-[minmax(0,1fr)_minmax(15rem,20rem)]">
        <MutableLines<TaxRateRow>
          rows={rates}
          fields={fields}
          getRowId={(row) => row.id}
          createRow={() => ({
            id: crypto.randomUUID(),
            ratePercent: "0",
            name: "",
          })}
          onRowsChange={(
            nextRows: TaxRateRow[],
            change: EditableLineDataGridChange<TaxRateRow>,
          ) => {
            setRates(nextRows);
            if (change.type === "row_deleted" && change.row) {
              if (change.row.id === defaultSalesTaxRateId) {
                setDefaultSalesTaxRateId(null);
              }
              if (change.row.id === defaultPurchaseTaxRateId) {
                setDefaultPurchaseTaxRateId(null);
              }
            }
          }}
          addLabel="Add row"
          initializeBlankRow={false}
          emptyMessage="No tax rates yet."
        />

        <div className="flex flex-col gap-(--space-8)">
          <DefaultTaxSelect
            label="Default tax on sales orders"
            value={defaultSalesTaxRateId}
            rates={options}
            onChange={setDefaultSalesTaxRateId}
          />
          <DefaultTaxSelect
            label="Default tax on purchase orders"
            value={defaultPurchaseTaxRateId}
            rates={options}
            onChange={setDefaultPurchaseTaxRateId}
          />
        </div>
      </div>
    </SettingsPanel>
  );
}

function DefaultTaxSelect({
  label,
  value,
  rates,
  onChange,
}: {
  label: string;
  value: string | null;
  rates: TaxRateRow[];
  onChange: (value: string | null) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value ?? NO_TAX_VALUE}
        onValueChange={(next) => onChange(next === NO_TAX_VALUE ? null : next)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TAX_VALUE}>0% — Tax exempt</SelectItem>
          {rates.map((rate) => (
            <SelectItem key={rate.id} value={rate.id}>
              {rate.ratePercent}% — {rate.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
