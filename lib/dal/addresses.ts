import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { addressEntries } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  normalizeAddressFields,
  type AddressEntryFields,
} from "@/lib/addresses";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  CreateAddressEntry,
  UpdateAddressEntry,
} from "@/lib/schemas/addresses";

export type AddressEntry = AddressEntryFields & {
  createdAt: Date;
  updatedAt: Date;
};

function normalizeAddressEntryInput(data: CreateAddressEntry | UpdateAddressEntry) {
  return {
    label: data.label.trim(),
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    ...normalizeAddressFields(data),
    deliveryInstructions: data.deliveryInstructions,
    notes: data.notes,
  };
}

function selectAddressEntry() {
  return {
    id: addressEntries.id,
    label: addressEntries.label,
    contactName: addressEntries.contactName,
    contactPhone: addressEntries.contactPhone,
    line1: addressEntries.line1,
    line2: addressEntries.line2,
    city: addressEntries.city,
    region: addressEntries.region,
    postcode: addressEntries.postcode,
    country: addressEntries.country,
    deliveryInstructions: addressEntries.deliveryInstructions,
    notes: addressEntries.notes,
    createdAt: addressEntries.createdAt,
    updatedAt: addressEntries.updatedAt,
  };
}

export async function getAddressEntries() {
  return withAuthedOrgContext(async (tx, orgId) => {
    return tx
      .select(selectAddressEntry())
      .from(addressEntries)
      .where(
        and(eq(addressEntries.organizationId, orgId), isNull(addressEntries.deletedAt))
      )
      .orderBy(asc(addressEntries.label), asc(addressEntries.createdAt));
  });
}

export async function createAddressEntry(data: CreateAddressEntry) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [entry] = await tx
      .insert(addressEntries)
      .values({
        organizationId: orgId,
        ...normalizeAddressEntryInput(data),
      })
      .returning(selectAddressEntry());

    return entry;
  });
}

export async function updateAddressEntry(id: string, data: UpdateAddressEntry) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [entry] = await tx
      .update(addressEntries)
      .set({
        ...normalizeAddressEntryInput(data),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(addressEntries.id, id),
          eq(addressEntries.organizationId, orgId),
          isNull(addressEntries.deletedAt)
        )
      )
      .returning(selectAddressEntry());

    return entry ?? null;
  });
}

export async function deleteAddressEntry(id: string) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [entry] = await tx
      .update(addressEntries)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(addressEntries.id, id),
          eq(addressEntries.organizationId, orgId),
          isNull(addressEntries.deletedAt)
        )
      )
      .returning({ id: addressEntries.id });

    return Boolean(entry);
  });
}

export async function getAddressEntryInTx(
  tx: Tx,
  organizationId: string,
  id: string
) {
  const [entry] = await tx
    .select(selectAddressEntry())
    .from(addressEntries)
    .where(
      and(
        eq(addressEntries.id, id),
        eq(addressEntries.organizationId, organizationId),
        isNull(addressEntries.deletedAt)
      )
    );

  return entry ?? null;
}
