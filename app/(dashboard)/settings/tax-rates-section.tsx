"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { AutosaveStatus } from "@/components/autosave-status";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SettingsBlock,
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings-panel";
import { apiJson } from "@/lib/client/api";

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
    mutationFn: (data: TaxRatesSectionData) =>
      apiJson<TaxRatesSectionData>("/api/tax-settings", {
        method: "PUT",
        body: data,
        fallbackError: "Failed to save tax settings.",
      }),
  });
  const saveTaxSettings = mutation.mutate;

  const fields = useMemo<LineField<TaxRateRow>[]>(
    () => [
      {
        field: "ratePercent",
        kind: "number",
        headerName: "Rate",
        width: 110,
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
  const saveState = mutation.isPending
    ? "saving"
    : mutation.isError
      ? "error"
      : "idle";

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Tax rates"
        sub="Applied to sales and purchase order lines to calculate tax totals."
      />

      <SettingsCard>
        <SettingsBlock
          title="Rates"
          count={rates.length}
          actions={<AutosaveStatus state={saveState} />}
        >
          <div className="max-w-xl">
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
              addLabel="Add rate"
              initializeBlankRow={false}
              emptyMessage="No tax rates yet."
            />
          </div>
        </SettingsBlock>

        <SettingsBlock title="Defaults">
          <div className="grid max-w-2xl gap-(--space-8) sm:grid-cols-2">
            <DefaultTaxSelect
              id="default-sales-tax"
              label="New sales orders"
              value={defaultSalesTaxRateId}
              rates={options}
              onChange={setDefaultSalesTaxRateId}
            />
            <DefaultTaxSelect
              id="default-purchase-tax"
              label="New purchase orders"
              value={defaultPurchaseTaxRateId}
              rates={options}
              onChange={setDefaultPurchaseTaxRateId}
            />
          </div>
        </SettingsBlock>
      </SettingsCard>
    </div>
  );
}

function DefaultTaxSelect({
  id,
  label,
  value,
  rates,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  rates: TaxRateRow[];
  onChange: (value: string | null) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value ?? ""} onValueChange={(next) => onChange(next)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {rates.map((rate) => (
            <SelectItem key={rate.id} value={rate.id}>
              {rate.ratePercent}% · {rate.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
