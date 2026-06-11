"use client";

import type { ReactNode } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
} from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  formatAddressInline,
  formatAddressLines,
  normalizeAddressFields,
} from "@/lib/addresses";

export type DeliveryAddressFields = {
  shipAddressEntryId?: string | null;
  shipContactName?: string | null;
  shipContactPhone?: string | null;
  shipLine1?: string | null;
  shipLine2?: string | null;
  shipCity?: string | null;
  shipRegion?: string | null;
  shipPostcode?: string | null;
  shipCountry?: string | null;
  shipDeliveryInstructions?: string | null;
};

export type DeliveryAddressOption = Required<DeliveryAddressFields> & {
  id: string;
  label: string;
  addressEntryId: string | null;
  notes: string | null;
};

const ADD_DELIVERY_ADDRESS_VALUE = "__add_delivery_address__";
const EDIT_DELIVERY_ADDRESS_VALUE = "__edit_delivery_address__";
const NULL_DELIVERY_ADDRESS_VALUE = "__null_delivery_address__";

export function normalizeDeliveryAddress(
  address: DeliveryAddressFields | undefined,
): Required<DeliveryAddressFields> {
  const normalized = normalizeAddressFields({
    line1: address?.shipLine1,
    line2: address?.shipLine2,
    city: address?.shipCity,
    region: address?.shipRegion,
    postcode: address?.shipPostcode,
    country: address?.shipCountry,
  });

  return {
    shipAddressEntryId: address?.shipAddressEntryId ?? null,
    shipContactName: address?.shipContactName?.trim() || null,
    shipContactPhone: address?.shipContactPhone?.trim() || null,
    shipLine1: normalized.line1,
    shipLine2: normalized.line2,
    shipCity: normalized.city,
    shipRegion: normalized.region,
    shipPostcode: normalized.postcode,
    shipCountry: normalized.country,
    shipDeliveryInstructions: address?.shipDeliveryInstructions?.trim() || null,
  };
}

export function deliveryAddressKey(address: DeliveryAddressFields | undefined) {
  const normalized = normalizeDeliveryAddress(address);
  if (normalized.shipAddressEntryId)
    return `address:${normalized.shipAddressEntryId}`;
  return [
    normalized.shipLine1,
    normalized.shipLine2,
    normalized.shipCity,
    normalized.shipRegion,
    normalized.shipPostcode,
    normalized.shipCountry,
  ]
    .map((part) => part ?? "")
    .join("\u001f")
    .replace(/^\u001f+|\u001f+$/g, "");
}

export function deliveryAddressLabel(address: DeliveryAddressFields) {
  return formatAddressInline({
    line1: address.shipLine1,
    line2: address.shipLine2,
    city: address.shipCity,
    region: address.shipRegion,
    postcode: address.shipPostcode,
    country: address.shipCountry,
  });
}

export function makeDeliveryAddressOption(
  address: DeliveryAddressFields | undefined,
  label?: string | null,
  notes?: string | null,
): DeliveryAddressOption | null {
  const normalized = normalizeDeliveryAddress(address);
  const id = deliveryAddressKey(normalized);
  if (id === "") return null;

  return {
    ...normalized,
    id,
    addressEntryId: normalized.shipAddressEntryId,
    label: label?.trim() || deliveryAddressLabel(normalized),
    notes: notes ?? null,
  };
}

export function DeliveryAddressInput({
  id,
  label,
  value,
  options,
  onChange,
  onAddNew,
  onEdit,
  inputClassName,
  labelClassName,
  nullOptionLabel,
  readOnly = false,
  readOnlyClassName,
}: {
  id: string;
  label?: ReactNode;
  value: DeliveryAddressFields | undefined;
  options: DeliveryAddressOption[];
  onChange: (address: DeliveryAddressFields | null) => void;
  onAddNew?: () => void;
  onEdit?: (address: DeliveryAddressOption) => void;
  inputClassName?: string;
  labelClassName?: string;
  nullOptionLabel?: string;
  readOnly?: boolean;
  readOnlyClassName?: string;
}) {
  const currentAddressId = deliveryAddressKey(value);
  const currentValue = nullOptionLabel && currentAddressId === ""
    ? NULL_DELIVERY_ADDRESS_VALUE
    : currentAddressId;
  const canEditCurrent = currentAddressId !== "" && Boolean(onEdit);
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const items = [
    ...(nullOptionLabel ? [NULL_DELIVERY_ADDRESS_VALUE] : []),
    ...optionIds,
    ...(canEditCurrent ? [EDIT_DELIVERY_ADDRESS_VALUE] : []),
    ...(onAddNew ? [ADD_DELIVERY_ADDRESS_VALUE] : []),
  ];
  const addressLines = formatAddressLines({
    line1: value?.shipLine1 ?? null,
    line2: value?.shipLine2 ?? null,
    city: value?.shipCity ?? null,
    region: value?.shipRegion ?? null,
    postcode: value?.shipPostcode ?? null,
    country: value?.shipCountry ?? null,
  });

  return (
    <Field>
      <FieldLabel className={labelClassName ?? (label ? undefined : "sr-only")} htmlFor={id}>
        {label ?? "Delivery Address"}
      </FieldLabel>
      {readOnly ? (
        <div className={readOnlyClassName}>
          {addressLines.length > 0
            ? addressLines.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)
            : "No delivery address set"}
        </div>
      ) : (
        <Combobox
          items={items}
          value={currentValue}
          onValueChange={(nextValue) => {
            if (!nextValue || nextValue === NULL_DELIVERY_ADDRESS_VALUE) {
              onChange(null);
              return;
            }
            if (nextValue === ADD_DELIVERY_ADDRESS_VALUE) {
              onAddNew?.();
              return;
            }
            if (nextValue === EDIT_DELIVERY_ADDRESS_VALUE) {
              const option = optionMap.get(currentAddressId);
              if (option) onEdit?.(option);
              return;
            }

            onChange(optionMap.get(nextValue) ?? null);
          }}
          itemToStringLabel={(itemId) => {
            if (itemId === NULL_DELIVERY_ADDRESS_VALUE)
              return nullOptionLabel ?? "";
            if (itemId === ADD_DELIVERY_ADDRESS_VALUE) return "Add new address";
            if (itemId === EDIT_DELIVERY_ADDRESS_VALUE)
              return "Edit selected address";
            return optionMap.get(itemId)?.label ?? "";
          }}
        >
          <ComboboxInput
            id={id}
            placeholder="Address"
            showClear={currentAddressId !== ""}
            className={inputClassName ?? "w-full min-w-0"}
          />
          <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-[var(--color-surface)] text-[var(--color-ink)]">
            <ComboboxEmpty>No addresses found</ComboboxEmpty>
            <ComboboxList>
              {(itemId: string) => {
                if (itemId === NULL_DELIVERY_ADDRESS_VALUE) {
                  return (
                    <ComboboxItem key={itemId} value={itemId}>
                      {nullOptionLabel}
                    </ComboboxItem>
                  );
                }
                if (itemId === ADD_DELIVERY_ADDRESS_VALUE) {
                  return (
                    <ComboboxItem key={itemId} value={itemId}>
                      Add new address
                    </ComboboxItem>
                  );
                }
                if (itemId === EDIT_DELIVERY_ADDRESS_VALUE) {
                  return (
                    <ComboboxItem key={itemId} value={itemId}>
                      Edit selected address
                    </ComboboxItem>
                  );
                }

                return (
                  <ComboboxItem key={itemId} value={itemId}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {optionMap.get(itemId)?.label}
                      </span>
                      {optionMap.get(itemId)?.shipContactName ? (
                        <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                          {optionMap.get(itemId)?.shipContactName}
                        </span>
                      ) : null}
                      <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                        {deliveryAddressLabel(optionMap.get(itemId) ?? {})}
                      </span>
                    </span>
                  </ComboboxItem>
                );
              }}
            </ComboboxList>
            {optionIds.length > 0 ? <ComboboxSeparator /> : null}
          </ComboboxContent>
        </Combobox>
      )}
    </Field>
  );
}
