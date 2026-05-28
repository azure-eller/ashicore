"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { SettingsPanel } from "./settings-panel";

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

  return (
    <SettingsPanel id="tax-rates" className="border-0 bg-transparent">
      <div className="px-(--space-0) py-(--space-0)">
        <h2 className="text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold">
          Tax rates
        </h2>
        <p className="mt-(--space-5) max-w-[72rem] text-[length:var(--text-sm)] leading-[var(--leading-md)]">
          Set and edit tax rates for products and transactions to ensure accurate tax calculations and compliance. Tax rates are applied to items on sales and purchase orders to calculate the total price or cost of items on the order with taxes.{" "}
          <a className="text-primary underline-offset-2 hover:underline" href="#">
            Learn more
          </a>
        </p>

        <div className="mt-(--space-10) grid gap-(--space-12) lg:grid-cols-[minmax(28rem,34rem)_minmax(18rem,34rem)]">
          <div>
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
          </div>

          <div className="flex flex-col gap-(--space-8)">
            <DefaultTaxSelect
              label="Default tax on Sales order"
              value={defaultSalesTaxRateId}
              rates={options}
              onChange={setDefaultSalesTaxRateId}
            />
            <DefaultTaxSelect
              label="Default tax on Purchase order"
              value={defaultPurchaseTaxRateId}
              rates={options}
              onChange={setDefaultPurchaseTaxRateId}
            />
            <div className="text-[length:var(--text-xs)] text-muted-foreground">
              {mutation.isPending ? "Saving..." : mutation.isError ? "Changes not saved" : "All changes saved"}
            </div>
          </div>
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
    <label className="block">
      <span className="block text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-muted-foreground">
        {label}
      </span>
      <select
        className="mt-(--space-1) h-(--height-input-md) w-full border-0 border-b border-border bg-transparent px-0 text-[length:var(--text-sm)] outline-none focus:border-primary"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        {value == null ? <option value="">0% - Tax Exempt</option> : null}
        {rates.map((rate) => (
          <option key={rate.id} value={rate.id}>
            {rate.ratePercent}% - {rate.name}
          </option>
        ))}
      </select>
    </label>
  );
}
