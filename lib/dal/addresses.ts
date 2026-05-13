import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { addressEntries } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { normalizeAddressFields } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  CreateAddressEntry,
  UpdateAddressEntry,
} from "@/lib/schemas/addresses";

export type AddressEntry = {
  id: string;
  label: string;
  contactName: string | null;
  contactPhone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeAddressEntryInput(data: CreateAddressEntry | UpdateAddressEntry) {
  const address = normalizeAddressFields({
    line1: data.line1,
    line2: data.line2,
    city: data.city,
    region: data.region,
    postcode: data.postcode,
    country: data.country,
  });

  return {
    label: data.label.trim(),
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postcode: address.postcode,
    country: address.country,
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
