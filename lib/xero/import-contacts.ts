import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { Address, type Contact } from "xero-node";
import { customers, suppliers } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { getAuthedXeroClient } from "./client";
import { XeroError, extractXeroMessage, redactXeroError } from "./errors";

export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type CustomerAddressFields = {
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
};

type SupplierAddressFields = {
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
};

function addressByType(
  addresses: Address[] | undefined,
  type: Address.AddressTypeEnum
): Address | undefined {
  return addresses?.find((a) => a.addressType === type);
}

function mapCustomerAddresses(contact: Contact): CustomerAddressFields {
  const billing = addressByType(contact.addresses, Address.AddressTypeEnum.POBOX);
  const shipping = addressByType(contact.addresses, Address.AddressTypeEnum.STREET);

  return {
    billingLine1: billing?.addressLine1 ?? null,
    billingLine2: billing?.addressLine2 ?? null,
    billingCity: billing?.city ?? null,
    billingRegion: billing?.region ?? null,
    billingPostcode: billing?.postalCode ?? null,
    billingCountry: billing?.country ?? null,
    shipLine1: shipping?.addressLine1 ?? null,
    shipLine2: shipping?.addressLine2 ?? null,
    shipCity: shipping?.city ?? null,
    shipRegion: shipping?.region ?? null,
    shipPostcode: shipping?.postalCode ?? null,
    shipCountry: shipping?.country ?? null,
  };
}

function mapSupplierAddresses(contact: Contact): SupplierAddressFields {
  const billing = addressByType(contact.addresses, Address.AddressTypeEnum.POBOX);
  return {
    billingLine1: billing?.addressLine1 ?? null,
    billingLine2: billing?.addressLine2 ?? null,
    billingCity: billing?.city ?? null,
    billingRegion: billing?.region ?? null,
    billingPostcode: billing?.postalCode ?? null,
    billingCountry: billing?.country ?? null,
  };
}

async function fetchAllContacts(
  orgId: string,
  where: string
): Promise<Contact[]> {
  const authed = await getAuthedXeroClient(orgId);
  const all: Contact[] = [];
  const pageSize = 100;
  let page = 1;

  while (true) {
    try {
      const response = await authed.client.accountingApi.getContacts(
        authed.tenantId,
        undefined,
        where,
        undefined,
        undefined,
        page,
        undefined,
        undefined,
        undefined,
        pageSize
      );
      const batch = response.body.contacts ?? [];
      all.push(...batch);
      if (batch.length < pageSize) break;
      page += 1;
    } catch (error) {
      console.error("Xero getContacts failed:", redactXeroError(error));
      throw new XeroError(
        `Failed to fetch Xero contacts: ${extractXeroMessage(error)}`,
        502
      );
    }
  }

  return all;
}

async function findExistingCustomer(
  orgId: string,
  contact: Contact
) {
  return withOrgContext(orgId, async (tx) => {
    if (contact.contactID) {
      const [row] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.xeroContactId, contact.contactID),
            isNull(customers.deletedAt)
          )
        );
      if (row) return row.id;
    }

    if (contact.emailAddress) {
      const [row] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            sql`LOWER(${customers.email}) = LOWER(${contact.emailAddress})`,
            isNull(customers.deletedAt)
          )
        );
      if (row) return row.id;
    }

    if (contact.name) {
      const [row] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            sql`LOWER(${customers.name}) = LOWER(${contact.name})`,
            isNull(customers.deletedAt)
          )
        );
      if (row) return row.id;
    }

    return null;
  });
}

async function findExistingSupplier(orgId: string, contact: Contact) {
  return withOrgContext(orgId, async (tx) => {
    if (contact.contactID) {
      const [row] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.xeroContactId, contact.contactID),
            isNull(suppliers.deletedAt)
          )
        );
      if (row) return row.id;
    }

    if (contact.emailAddress) {
      const [row] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(
            sql`LOWER(${suppliers.email}) = LOWER(${contact.emailAddress})`,
            isNull(suppliers.deletedAt)
          )
        );
      if (row) return row.id;
    }

    if (contact.name) {
      const [row] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(
            sql`LOWER(${suppliers.name}) = LOWER(${contact.name})`,
            isNull(suppliers.deletedAt)
          )
        );
      if (row) return row.id;
    }

    return null;
  });
}

export async function importCustomersFromXero(orgId: string): Promise<ImportResult> {
  const contacts = await fetchAllContacts(orgId, "IsCustomer==true");
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const contact of contacts) {
    if (!contact.name) {
      result.skipped += 1;
      continue;
    }

    try {
      const existingId = await findExistingCustomer(orgId, contact);
      const addr = mapCustomerAddresses(contact);

      await withOrgContext(orgId, async (tx) => {
        if (existingId) {
          await tx
            .update(customers)
            .set({
              name: contact.name!,
              email: contact.emailAddress ?? null,
              xeroContactId: contact.contactID ?? null,
              ...addr,
              updatedAt: new Date(),
            })
            .where(eq(customers.id, existingId));
          result.updated += 1;
        } else {
          await tx.insert(customers).values({
            organizationId: orgId,
            name: contact.name!,
            email: contact.emailAddress ?? null,
            xeroContactId: contact.contactID ?? null,
            ...addr,
          });
          result.created += 1;
        }
      });
    } catch (error) {
      console.error("Xero customer import row failed:", redactXeroError(error));
      result.errors.push(
        `${contact.name ?? "(unnamed)"}: ${extractXeroMessage(error)}`
      );
      result.skipped += 1;
    }
  }

  return result;
}

export async function importSuppliersFromXero(orgId: string): Promise<ImportResult> {
  const contacts = await fetchAllContacts(orgId, "IsSupplier==true");
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const contact of contacts) {
    if (!contact.name) {
      result.skipped += 1;
      continue;
    }

    try {
      const existingId = await findExistingSupplier(orgId, contact);
      const addr = mapSupplierAddresses(contact);

      await withOrgContext(orgId, async (tx) => {
        if (existingId) {
          await tx
            .update(suppliers)
            .set({
              name: contact.name!,
              email: contact.emailAddress ?? null,
              xeroContactId: contact.contactID ?? null,
              ...addr,
              updatedAt: new Date(),
            })
            .where(eq(suppliers.id, existingId));
          result.updated += 1;
        } else {
          await tx.insert(suppliers).values({
            organizationId: orgId,
            name: contact.name!,
            email: contact.emailAddress ?? null,
            xeroContactId: contact.contactID ?? null,
            ...addr,
          });
          result.created += 1;
        }
      });
    } catch (error) {
      console.error("Xero supplier import row failed:", redactXeroError(error));
      result.errors.push(
        `${contact.name ?? "(unnamed)"}: ${extractXeroMessage(error)}`
      );
      result.skipped += 1;
    }
  }

  return result;
}
