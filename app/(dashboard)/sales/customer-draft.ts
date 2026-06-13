import { useState } from "react";
import {
  normalizeAddressFields,
  type AddressEntryOption,
} from "@/lib/addresses";
import { customerDefaultValues } from "@/lib/schemas/customers";
import type {
  CustomerContactRow,
  CustomerDetailData,
} from "@/lib/sales/types";

export type ContactGridRow = CustomerContactRow & { isNew?: boolean };

export type AddressTarget = "billing" | "shipping";
export type CustomerAddressFields = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};
export type CustomerAddressOption = AddressEntryOption;

export function makeDraftCustomer(id: string): CustomerDetailData {
  const now = new Date();
  return {
    id,
    name: customerDefaultValues.name,
    customerCategoryId: customerDefaultValues.customerCategoryId ?? null,
    accountState: "active",
    accountPriority: "standard",
    email: customerDefaultValues.email ?? null,
    phone: customerDefaultValues.phone ?? null,
    billingLine1: customerDefaultValues.billingLine1 ?? null,
    billingLine2: customerDefaultValues.billingLine2 ?? null,
    billingCity: customerDefaultValues.billingCity ?? null,
    billingRegion: customerDefaultValues.billingRegion ?? null,
    billingPostcode: customerDefaultValues.billingPostcode ?? null,
    billingCountry: customerDefaultValues.billingCountry ?? null,
    shipLine1: customerDefaultValues.shipLine1 ?? null,
    shipLine2: customerDefaultValues.shipLine2 ?? null,
    shipCity: customerDefaultValues.shipCity ?? null,
    shipRegion: customerDefaultValues.shipRegion ?? null,
    shipPostcode: customerDefaultValues.shipPostcode ?? null,
    shipCountry: customerDefaultValues.shipCountry ?? null,
    customerCategoryName: null,
    openOrderCount: 0,
    openOrderValue: "0",
    latestOrderDate: null,
    primaryContactName: null,
    primaryContactEmail: null,
    primaryContactPhone: null,
    nextTaskId: null,
    nextTaskTitle: null,
    nextTaskDueDate: null,
    xeroContactId: null,
    version: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    contacts: [],
    activities: [],
    projects: [],
    salesOrders: [],
  };
}

export function toDocContact(row: ContactGridRow): CustomerContactRow {
  const contact = { ...row };
  delete contact.isNew;
  return contact;
}

export function contactPayload(row: ContactGridRow) {
  return {
    id: row.id,
    name: row.name.trim(),
    title: row.title || null,
    email: row.email || null,
    phone: row.phone || null,
    addressEntryId: row.addressEntryId || null,
    roles: row.roles,
  };
}

export function useSyncedRows<TRow extends { id: string }>(sourceRows: TRow[]) {
  const [rows, setRows] = useState<TRow[]>(sourceRows);
  const [lastSynced, setLastSynced] = useState(sourceRows);
  if (lastSynced !== sourceRows) {
    setLastSynced(sourceRows);
    setRows(sourceRows);
  }
  return [rows, setRows] as const;
}

export function upsertById<TRow extends { id: string }>(rows: TRow[], next: TRow) {
  return rows.some((row) => row.id === next.id)
    ? replaceRow(rows, next)
    : [...rows, next];
}

export function replaceRow<TRow extends { id: string }>(rows: TRow[], next: TRow) {
  return rows.map((row) => (row.id === next.id ? next : row));
}

export function getCustomerBillingAddress(customer: CustomerDetailData): CustomerAddressFields {
  return normalizeAddressFields({
    line1: customer.billingLine1,
    line2: customer.billingLine2,
    city: customer.billingCity,
    region: customer.billingRegion,
    postcode: customer.billingPostcode,
    country: customer.billingCountry,
  });
}

export function getCustomerShippingAddress(customer: CustomerDetailData): CustomerAddressFields {
  return normalizeAddressFields({
    line1: customer.shipLine1,
    line2: customer.shipLine2,
    city: customer.shipCity,
    region: customer.shipRegion,
    postcode: customer.shipPostcode,
    country: customer.shipCountry,
  });
}

export function shippingAddressPatch(address: CustomerAddressFields) {
  return {
    shipLine1: address.line1,
    shipLine2: address.line2,
    shipCity: address.city,
    shipRegion: address.region,
    shipPostcode: address.postcode,
    shipCountry: address.country,
  };
}

export function billingAddressPatch(address: CustomerAddressFields) {
  return {
    billingLine1: address.line1,
    billingLine2: address.line2,
    billingCity: address.city,
    billingRegion: address.region,
    billingPostcode: address.postcode,
    billingCountry: address.country,
  };
}
