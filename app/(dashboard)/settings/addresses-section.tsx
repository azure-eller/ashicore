"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { SettingsPanel, SettingsPanelHeader } from "@/components/settings-panel";
import { apiJson } from "@/lib/client/api";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY,
  getRegionOptions,
  normalizeCountry,
  normalizeRegion,
} from "@/lib/address-options";
import type { AddressEntry } from "@/lib/dal/addresses";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";

type AddressBookRow = Omit<AddressEntry, "createdAt" | "updatedAt">;
type SaveAddressInput = {
  clientId: string;
  row: AddressBookRow;
};

const TEMP_ID_PREFIX = "new:";
const EMPTY_OPTION = "__empty__";
const US_REGION_OPTIONS = getRegionOptions(DEFAULT_COUNTRY);
const US_REGION_VALUES = [EMPTY_OPTION, ...US_REGION_OPTIONS.map((option) => option.value)];
const COUNTRY_VALUES = [EMPTY_OPTION, ...COUNTRY_OPTIONS.map((option) => option.value)];

export function AddressesSection({ initialData }: { initialData: AddressBookRow[] }) {
  const [addresses, setAddresses] = useState(initialData);
  const inFlightSavesRef = useRef(new Set<string>());

  const saveMutation = useMutation({
    mutationFn: ({ clientId, row }: SaveAddressInput) =>
      apiJson<AddressEntry>(
        isTemporaryId(clientId) ? "/api/addresses" : `/api/addresses/${clientId}`,
        {
          method: isTemporaryId(clientId) ? "POST" : "PUT",
          body: createAddressEntrySchema.parse(rowToPayload(row)),
          fallbackError: "Failed to save address.",
        },
      ),
    onSuccess: (entry, { clientId }) => {
      const saved = toAddressBookRow(entry);
      setAddresses((current) =>
        current
          .map((row) => (row.id === clientId || row.id === saved.id ? saved : row))
          .sort((a, b) => a.label.localeCompare(b.label)),
      );
    },
    onSettled: (_data, _error, { clientId }) => {
      inFlightSavesRef.current.delete(clientId);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (row: AddressBookRow) =>
      isTemporaryId(row.id)
        ? Promise.resolve({ success: true })
        : apiJson<{ success: boolean }>(`/api/addresses/${row.id}`, {
            method: "DELETE",
            fallbackError: "Failed to delete address.",
          }),
  });

  const fields = useMemo<LineField<AddressBookRow>[]>(
    () => [
      {
        field: "label",
        kind: "text",
        headerName: "Label",
        width: 180,
        minWidth: 160,
        editable: true,
        getValidationErrors: (value) =>
          value?.trim() ? null : ["Label is required"],
      },
      {
        field: "line1",
        kind: "text",
        headerName: "Street address",
        width: 260,
        minWidth: 220,
        editable: true,
        valueFormatter: emptyFormatter,
      },
      {
        field: "line2",
        kind: "text",
        headerName: "Apt / suite",
        width: 150,
        editable: true,
        valueFormatter: emptyFormatter,
      },
      {
        field: "city",
        kind: "text",
        headerName: "City",
        width: 150,
        editable: true,
        valueFormatter: emptyFormatter,
      },
      {
        field: "region",
        kind: "select",
        headerName: "State",
        width: 120,
        editable: true,
        values: US_REGION_VALUES,
        getSelectLabel: regionLabel,
        valueFormatter: ({ value }) => regionLabel(String(value ?? EMPTY_OPTION)),
        valueSetter: ({ data, newValue }) => {
          if (!data) return false;
          data.region =
            newValue === EMPTY_OPTION
              ? null
              : normalizeRegion(data.country ?? DEFAULT_COUNTRY, String(newValue));
          return true;
        },
      },
      {
        field: "postcode",
        kind: "text",
        headerName: "Postal code",
        width: 140,
        editable: true,
        valueFormatter: emptyFormatter,
      },
      {
        field: "country",
        kind: "select",
        headerName: "Country",
        width: 170,
        editable: true,
        values: COUNTRY_VALUES,
        getSelectLabel: countryLabel,
        valueFormatter: ({ value }) => countryLabel(String(value ?? EMPTY_OPTION)),
        valueSetter: ({ data, newValue }) => {
          if (!data) return false;
          data.country = newValue === EMPTY_OPTION ? null : normalizeCountry(String(newValue));
          if (data.country !== DEFAULT_COUNTRY) {
            data.region = normalizeRegion(data.country, data.region);
          }
          return true;
        },
      },
      {
        field: "contactName",
        kind: "text",
        headerName: "Contact",
        width: 170,
        editable: true,
        valueFormatter: emptyFormatter,
      },
      {
        field: "contactPhone",
        kind: "text",
        headerName: "Phone",
        width: 150,
        editable: true,
        valueFormatter: emptyFormatter,
      },
      {
        field: "deliveryInstructions",
        kind: "text",
        headerName: "Delivery instructions",
        minWidth: 240,
        flex: 1,
        editable: true,
        valueFormatter: emptyFormatter,
      },
    ],
    [],
  );

  const status =
    saveMutation.isPending || deleteMutation.isPending
      ? "Saving..."
      : saveMutation.isError || deleteMutation.isError
        ? "Changes not saved"
        : "All changes saved";
  const actionError =
    saveMutation.error instanceof Error
      ? saveMutation.error.message
      : deleteMutation.error instanceof Error
        ? deleteMutation.error.message
        : null;

  function saveRow(row: AddressBookRow) {
    if (!row.label.trim() || inFlightSavesRef.current.has(row.id)) return;
    inFlightSavesRef.current.add(row.id);
    saveMutation.mutate({ clientId: row.id, row });
  }

  function handleRowsChange(
    nextRows: AddressBookRow[],
    change: EditableLineDataGridChange<AddressBookRow>,
  ) {
    setAddresses(nextRows);

    if (change.type === "row_deleted" && change.row) {
      deleteMutation.mutate(change.row);
      return;
    }

    if (change.row) {
      saveRow(change.row);
    }
  }

  return (
    <SettingsPanel id="addresses">
      <SettingsPanelHeader
        title="Addresses"
        meta="Delivery addresses shared by sales and purchasing."
        action={
          <span className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
            {status}
          </span>
        }
      />

      <div className="p-(--space-8)">
        <MutableLines<AddressBookRow>
          rows={addresses}
          fields={fields}
          getRowId={(row) => row.id}
          createRow={createAddressBookRow}
          onRowsChange={handleRowsChange}
          addLabel="Add address"
          initializeBlankRow={false}
          emptyMessage="No addresses yet."
          rowHeight={40}
          error={actionError}
          rowHasError={(row) => !row.label.trim()}
        />
      </div>
    </SettingsPanel>
  );
}

function createAddressBookRow(): AddressBookRow {
  return {
    id: `${TEMP_ID_PREFIX}${crypto.randomUUID()}`,
    label: "",
    contactName: null,
    contactPhone: null,
    line1: null,
    line2: null,
    city: null,
    region: null,
    postcode: null,
    country: DEFAULT_COUNTRY,
    deliveryInstructions: null,
    notes: null,
  };
}

function isTemporaryId(id: string) {
  return id.startsWith(TEMP_ID_PREFIX);
}

function rowToPayload(row: AddressBookRow) {
  return {
    label: row.label,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postcode: row.postcode,
    country: row.country,
    deliveryInstructions: row.deliveryInstructions,
    notes: row.notes,
  };
}

function toAddressBookRow(address: AddressEntry): AddressBookRow {
  return {
    id: address.id,
    label: address.label,
    contactName: address.contactName,
    contactPhone: address.contactPhone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postcode: address.postcode,
    country: address.country,
    deliveryInstructions: address.deliveryInstructions,
    notes: address.notes,
  };
}

function emptyFormatter({ value }: { value: unknown }) {
  return typeof value === "string" && value.length > 0 ? value : "-";
}

function regionLabel(value: string) {
  if (!value || value === EMPTY_OPTION) return "State";
  const normalized = normalizeRegion(DEFAULT_COUNTRY, value) ?? value;
  return (
    US_REGION_OPTIONS.find((option) => option.value === normalized)?.label ?? normalized
  );
}

function countryLabel(value: string) {
  if (!value || value === EMPTY_OPTION) return "Country";
  return normalizeCountry(value) ?? value;
}
