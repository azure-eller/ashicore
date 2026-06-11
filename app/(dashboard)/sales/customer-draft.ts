import { useState } from "react";
import {
  createCustomerContact,
  deleteCustomerContact,
  getCustomerCard,
  patchCustomer,
  updateCustomerContact,
} from "@/lib/api/clients/customers";
import {
  normalizeAddressFields,
  type AddressEntryOption,
} from "@/lib/addresses";
import {
  type InsertCustomer,
  type PatchCustomer,
} from "@/lib/schemas/customers";
import type {
  CustomerContactRow,
  CustomerDetailData,
} from "@/lib/sales/types";

export type ContactGridRow = CustomerContactRow & { isNew?: boolean };

export type CustomerDraftOp =
  | { type: "patch"; patch: PatchCustomer }
  | { type: "upsertContact"; row: ContactGridRow }
  | { type: "deleteContact"; contactId: string }
;
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

export function makeDraftCustomer(draft: InsertCustomer): CustomerDetailData {
  const now = new Date();
  return {
    id: "__draft__",
    ...draft,
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
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    contacts: [],
    activities: [],
    projects: [],
    salesOrders: [],
  };
}

export function normalizeCustomerDraft(draft: InsertCustomer): InsertCustomer {
  return {
    ...draft,
    name: draft.name.trim(),
  };
}

export function mergeCustomerPatch(
  customer: CustomerDetailData,
  patch: PatchCustomer
): CustomerDetailData {
  return {
    ...customer,
    ...patch,
    updatedAt: new Date(),
  };
}

export function applyCustomerDraftOp(
  customer: CustomerDetailData,
  op: CustomerDraftOp
): CustomerDetailData {
  if (op.type === "patch") return mergeCustomerPatch(customer, op.patch);
  if (op.type === "upsertContact") {
    const contacts = upsertById(customer.contacts, op.row);
    return { ...customer, contacts, updatedAt: new Date() };
  }
  return {
    ...customer,
    contacts: customer.contacts.filter((contact) => contact.id !== op.contactId),
    updatedAt: new Date(),
  };
}

export async function saveCustomerOps(
  customerId: string,
  draft: CustomerDetailData,
  ops: CustomerDraftOp[]
) {
  let changed = false;
  const patch = ops.reduce<PatchCustomer>(
    (next, op) => (op.type === "patch" ? { ...next, ...op.patch } : next),
    {},
  );
  if (Object.keys(patch).length > 0) {
    await patchCustomer(customerId, customerEditableSnapshot(draft));
    changed = true;
  }

  for (const op of ops) {
    if (op.type === "upsertContact") {
      if (!op.row.name.trim()) continue;
      if (op.row.isNew) {
        await createCustomerContact(customerId, contactPayload(op.row));
      } else {
        await updateCustomerContact(customerId, op.row.id, contactPayload(op.row));
      }
      changed = true;
    } else if (op.type === "deleteContact") {
      await deleteCustomerContact(customerId, op.contactId);
      changed = true;
    }
  }

  return changed ? getCustomerCard(customerId) : null;
}

export function contactPayload(row: ContactGridRow) {
  return {
    name: row.name.trim(),
    title: row.title || null,
    email: row.email || null,
    phone: row.phone || null,
    addressEntryId: row.addressEntryId || null,
    roles: row.roles,
  };
}

export function customerToInsertInput(customer: CustomerDetailData): InsertCustomer {
  return normalizeCustomerDraft({
    name: customer.name,
    customerCategoryId: customer.customerCategoryId,
    accountState: customer.accountState,
    accountPriority: customer.accountPriority,
    email: customer.email,
    phone: customer.phone,
    billingLine1: customer.billingLine1,
    billingLine2: customer.billingLine2,
    billingCity: customer.billingCity,
    billingRegion: customer.billingRegion,
    billingPostcode: customer.billingPostcode,
    billingCountry: customer.billingCountry,
    shipLine1: customer.shipLine1,
    shipLine2: customer.shipLine2,
    shipCity: customer.shipCity,
    shipRegion: customer.shipRegion,
    shipPostcode: customer.shipPostcode,
    shipCountry: customer.shipCountry,
  });
}

export function customerEditableSnapshot(customer: CustomerDetailData): PatchCustomer {
  return {
    name: customer.name,
    customerCategoryId: customer.customerCategoryId,
    accountState: customer.accountState,
    accountPriority: customer.accountPriority,
    email: customer.email,
    phone: customer.phone,
    billingLine1: customer.billingLine1,
    billingLine2: customer.billingLine2,
    billingCity: customer.billingCity,
    billingRegion: customer.billingRegion,
    billingPostcode: customer.billingPostcode,
    billingCountry: customer.billingCountry,
    shipLine1: customer.shipLine1,
    shipLine2: customer.shipLine2,
    shipCity: customer.shipCity,
    shipRegion: customer.shipRegion,
    shipPostcode: customer.shipPostcode,
    shipCountry: customer.shipCountry,
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

export function shippingAddressPatch(address: CustomerAddressFields): PatchCustomer {
  return {
    shipLine1: address.line1,
    shipLine2: address.line2,
    shipCity: address.city,
    shipRegion: address.region,
    shipPostcode: address.postcode,
    shipCountry: address.country,
  };
}

export function billingAddressPatch(address: CustomerAddressFields): PatchCustomer {
  return {
    billingLine1: address.line1,
    billingLine2: address.line2,
    billingCity: address.city,
    billingRegion: address.region,
    billingPostcode: address.postcode,
    billingCountry: address.country,
  };
}
