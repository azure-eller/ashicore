import "server-only";

import { and, eq } from "drizzle-orm";
import {
  customers,
  integrationExternalRecords,
  suppliers,
} from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { ACCOUNTING_PROVIDER_QUICKBOOKS } from "@/lib/accounting/constants";
import { upsertExternalRecordInTx } from "@/lib/integrations/external-records";
import {
  quickBooksQueryEndpoint,
  quickBooksRequest,
  quickBooksSqlString,
} from "./client";

type QuickBooksNamedEntity = {
  Id?: string;
  DisplayName?: string;
  PrimaryEmailAddr?: { Address?: string };
};

type CustomerQueryResponse = {
  QueryResponse?: { Customer?: QuickBooksNamedEntity[] };
};

type VendorQueryResponse = {
  QueryResponse?: { Vendor?: QuickBooksNamedEntity[] };
};

type CreateCustomerResponse = {
  Customer?: QuickBooksNamedEntity;
};

type CreateVendorResponse = {
  Vendor?: QuickBooksNamedEntity;
};

type CustomerRow = typeof customers.$inferSelect;
type SupplierRow = typeof suppliers.$inferSelect;

async function findQuickBooksCustomer(orgId: string, customer: CustomerRow) {
  if (customer.email) {
    const byEmail = await quickBooksRequest<CustomerQueryResponse>(
      orgId,
      quickBooksQueryEndpoint(
        `select * from Customer where PrimaryEmailAddr = ${quickBooksSqlString(customer.email)}`
      )
    );
    const match = byEmail.QueryResponse?.Customer?.[0];
    if (match?.Id) return match;
  }

  const byName = await quickBooksRequest<CustomerQueryResponse>(
    orgId,
    quickBooksQueryEndpoint(
      `select * from Customer where DisplayName = ${quickBooksSqlString(customer.name)}`
    )
  );
  return byName.QueryResponse?.Customer?.[0] ?? null;
}

async function findQuickBooksVendor(orgId: string, supplier: SupplierRow) {
  if (supplier.email) {
    const target = supplier.email.trim().toLowerCase();
    let startPosition = 1;

    while (true) {
      const page = await quickBooksRequest<VendorQueryResponse>(
        orgId,
        quickBooksQueryEndpoint(
          `select * from Vendor where Active = true startposition ${startPosition} maxresults 1000`
        )
      );
      const vendors = page.QueryResponse?.Vendor ?? [];
      const match = vendors.find(
        (vendor) =>
          vendor.PrimaryEmailAddr?.Address?.trim().toLowerCase() === target
      );
      if (match?.Id) return match;
      if (vendors.length < 1000) break;
      startPosition += vendors.length;
    }
  }

  const byName = await quickBooksRequest<VendorQueryResponse>(
    orgId,
    quickBooksQueryEndpoint(
      `select * from Vendor where DisplayName = ${quickBooksSqlString(supplier.name)}`
    )
  );
  return byName.QueryResponse?.Vendor?.[0] ?? null;
}

function compactAddress(input: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
}) {
  if (
    !input.line1 &&
    !input.line2 &&
    !input.city &&
    !input.region &&
    !input.postcode &&
    !input.country
  ) {
    return undefined;
  }
  return {
    Line1: input.line1 ?? undefined,
    Line2: input.line2 ?? undefined,
    City: input.city ?? undefined,
    CountrySubDivisionCode: input.region ?? undefined,
    PostalCode: input.postcode ?? undefined,
    Country: input.country ?? undefined,
  };
}

async function existingExternalId(
  tx: Tx,
  params: {
    organizationId: string;
    entityType: "customer" | "supplier";
    localRecordId: string;
  }
) {
  const [row] = await tx
    .select({ externalId: integrationExternalRecords.externalId })
    .from(integrationExternalRecords)
    .where(
      and(
        eq(integrationExternalRecords.organizationId, params.organizationId),
        eq(integrationExternalRecords.provider, ACCOUNTING_PROVIDER_QUICKBOOKS),
        eq(integrationExternalRecords.entityType, params.entityType),
        eq(integrationExternalRecords.localRecordId, params.localRecordId)
      )
    );
  return row?.externalId ?? null;
}

export async function upsertQuickBooksCustomer(
  orgId: string,
  customer: CustomerRow
) {
  const saved = await withOrgContext(orgId, async (tx) =>
    existingExternalId(tx, {
      organizationId: orgId,
      entityType: "customer",
      localRecordId: customer.id,
    })
  );
  if (saved) return { id: saved, name: customer.name };

  let external = await findQuickBooksCustomer(orgId, customer);

  if (!external?.Id) {
    const created = await quickBooksRequest<CreateCustomerResponse>(
      orgId,
      "/customer",
      {
        method: "POST",
        body: JSON.stringify({
          DisplayName: customer.name,
          PrimaryEmailAddr: customer.email
            ? { Address: customer.email }
            : undefined,
          PrimaryPhone: customer.phone
            ? { FreeFormNumber: customer.phone }
            : undefined,
          BillAddr: compactAddress({
            line1: customer.billingLine1,
            line2: customer.billingLine2,
            city: customer.billingCity,
            region: customer.billingRegion,
            postcode: customer.billingPostcode,
            country: customer.billingCountry,
          }),
        }),
      }
    );
    external = created.Customer ?? null;
  }

  if (!external?.Id) {
    throw new Error("QuickBooks did not return a customer id.");
  }

  await withOrgContext(orgId, async (tx) => {
    await upsertExternalRecordInTx(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
      entityType: "customer",
      localRecordId: customer.id,
      externalId: external.Id,
      externalName: external.DisplayName ?? customer.name,
    });
  });

  return { id: external.Id, name: external.DisplayName ?? customer.name };
}

export async function upsertQuickBooksVendor(orgId: string, supplier: SupplierRow) {
  const saved = await withOrgContext(orgId, async (tx) =>
    existingExternalId(tx, {
      organizationId: orgId,
      entityType: "supplier",
      localRecordId: supplier.id,
    })
  );
  if (saved) return { id: saved, name: supplier.name };

  let external = await findQuickBooksVendor(orgId, supplier);

  if (!external?.Id) {
    const created = await quickBooksRequest<CreateVendorResponse>(
      orgId,
      "/vendor",
      {
        method: "POST",
        body: JSON.stringify({
          DisplayName: supplier.name,
          PrimaryEmailAddr: supplier.email
            ? { Address: supplier.email }
            : undefined,
          PrimaryPhone: supplier.phone
            ? { FreeFormNumber: supplier.phone }
            : undefined,
          BillAddr: compactAddress({
            line1: supplier.billingLine1,
            line2: supplier.billingLine2,
            city: supplier.billingCity,
            region: supplier.billingRegion,
            postcode: supplier.billingPostcode,
            country: supplier.billingCountry,
          }),
        }),
      }
    );
    external = created.Vendor ?? null;
  }

  if (!external?.Id) {
    throw new Error("QuickBooks did not return a vendor id.");
  }

  await withOrgContext(orgId, async (tx) => {
    await upsertExternalRecordInTx(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
      entityType: "supplier",
      localRecordId: supplier.id,
      externalId: external.Id,
      externalName: external.DisplayName ?? supplier.name,
    });
  });

  return { id: external.Id, name: external.DisplayName ?? supplier.name };
}
