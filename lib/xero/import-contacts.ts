import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { Address, type Contact, Phone } from "xero-node";
import {
  customers,
  integrationExternalRecords,
  purchaseOrders,
  salesOrders,
  suppliers,
  integrationImportRunRows,
  integrationImportRuns,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { withOrgContext } from "@/lib/db/with-org-context";
import { normalizeAddressFields } from "@/lib/addresses";
import { getAuthedXeroClient } from "./client";
import { XeroError, extractXeroMessage, redactXeroError } from "./errors";
import { upsertExternalRecordInTx } from "@/lib/integrations/external-records";
import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/sync-state";
import {
  cleanDate as cleanAccountingDate,
  cleanString as cleanAccountingString,
  normalizeProviderKey,
} from "@/lib/accounting/providers/common";
import { isDemoCompanyTenant } from "./import-utils";

const XERO_PROVIDER = ACCOUNTING_PROVIDER_XERO;

export type ContactImportEntity = "customers" | "suppliers";

export type ImportResult = {
  runId: string;
  tenantName: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export type ContactImportPreview = {
  entityType: ContactImportEntity;
  tenantName: string;
  isDemoCompany: boolean;
  totalFetched: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
  errors: string[];
  sampleCreates: string[];
  sampleUpdates: string[];
  sampleSkipped: string[];
};

export type ImportUndoPreview = {
  runId: string;
  entityType: ContactImportEntity;
  tenantName: string;
  status: string;
  createdRows: number;
  updatedRows: number;
  blockedRows: number;
  canUndo: boolean;
  sampleNames: string[];
  blockedNames: string[];
};

export type ImportUndoResult = ImportUndoPreview & {
  undoneCreatedRows: number;
  restoredUpdatedRows: number;
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

type CustomerSnapshot = CustomerAddressFields & {
  name: string;
  email: string | null;
  phone: string | null;
};

type SupplierSnapshot = SupplierAddressFields & {
  name: string;
  email: string | null;
  phone: string | null;
};

type ExistingCustomer = CustomerSnapshot & { id: string; xeroContactId: string | null };
type ExistingSupplier = SupplierSnapshot & {
  id: string;
  xeroContactId: string | null;
};
type ExistingContactMaps = Awaited<ReturnType<typeof loadExistingContactMapsInTx>>;

function customerSnapshot(row: ExistingCustomer): CustomerSnapshot {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    billingLine1: row.billingLine1,
    billingLine2: row.billingLine2,
    billingCity: row.billingCity,
    billingRegion: row.billingRegion,
    billingPostcode: row.billingPostcode,
    billingCountry: row.billingCountry,
    shipLine1: row.shipLine1,
    shipLine2: row.shipLine2,
    shipCity: row.shipCity,
    shipRegion: row.shipRegion,
    shipPostcode: row.shipPostcode,
    shipCountry: row.shipCountry,
  };
}

function supplierSnapshot(row: ExistingSupplier): SupplierSnapshot {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    billingLine1: row.billingLine1,
    billingLine2: row.billingLine2,
    billingCity: row.billingCity,
    billingRegion: row.billingRegion,
    billingPostcode: row.billingPostcode,
    billingCountry: row.billingCountry,
  };
}

function addressByType(
  addresses: Address[] | undefined,
  type: Address.AddressTypeEnum
): Address | undefined {
  return addresses?.find((a) => a.addressType === type);
}

function normalizeXeroAddress(address: Address | undefined) {
  return normalizeAddressFields({
    line1: address?.addressLine1 ?? null,
    line2: address?.addressLine2 ?? null,
    city: address?.city ?? null,
    region: address?.region ?? null,
    postcode: address?.postalCode ?? null,
    country: address?.country ?? null,
  });
}

const cleanString = cleanAccountingString;

function phoneValue(phone: Phone | undefined) {
  if (!phone) return null;
  return cleanString(
    [phone.phoneCountryCode, phone.phoneAreaCode, phone.phoneNumber]
      .map((part) => cleanString(part))
      .filter(Boolean)
      .join(" "),
    50
  );
}

const cleanDate = cleanAccountingDate;

function mapPhone(contact: Contact) {
  const phones = contact.phones ?? [];
  return (
    phoneValue(
      phones.find((phone) => phone.phoneType === Phone.PhoneTypeEnum.DEFAULT)
    ) ??
    phoneValue(phones.find((phone) => phoneValue(phone) != null))
  );
}

function mapCustomerAddresses(contact: Contact): CustomerAddressFields {
  const billing = addressByType(contact.addresses, Address.AddressTypeEnum.POBOX);
  const shipping = addressByType(contact.addresses, Address.AddressTypeEnum.STREET);
  const billingAddress = normalizeXeroAddress(billing);
  const shippingAddress = normalizeXeroAddress(shipping);

  return {
    billingLine1: billingAddress.line1,
    billingLine2: billingAddress.line2,
    billingCity: billingAddress.city,
    billingRegion: billingAddress.region,
    billingPostcode: billingAddress.postcode,
    billingCountry: billingAddress.country,
    shipLine1: shippingAddress.line1,
    shipLine2: shippingAddress.line2,
    shipCity: shippingAddress.city,
    shipRegion: shippingAddress.region,
    shipPostcode: shippingAddress.postcode,
    shipCountry: shippingAddress.country,
  };
}

function mapSupplierAddresses(contact: Contact): SupplierAddressFields {
  const billing = addressByType(contact.addresses, Address.AddressTypeEnum.POBOX);
  const billingAddress = normalizeXeroAddress(billing);
  return {
    billingLine1: billingAddress.line1,
    billingLine2: billingAddress.line2,
    billingCity: billingAddress.city,
    billingRegion: billingAddress.region,
    billingPostcode: billingAddress.postcode,
    billingCountry: billingAddress.country,
  };
}

function isXeroEntity(contact: Contact, entityType: ContactImportEntity) {
  return entityType === "customers"
    ? contact.isCustomer === true
    : contact.isSupplier === true;
}

function whereForImport() {
  return 'ContactStatus=="ACTIVE"';
}

async function fetchAllContacts(orgId: string): Promise<{
  tenantId: string;
  tenantName: string;
  contacts: Contact[];
}> {
  const authed = await getAuthedXeroClient(orgId);
  const all: Contact[] = [];
  const pageSize = 100;
  let page = 1;

  while (true) {
    try {
      const response = await authed.client.accountingApi.getContacts(
        authed.tenantId,
        undefined,
        whereForImport(),
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

  return {
    tenantId: authed.tenantId,
    tenantName: authed.tenantName,
    contacts: all,
  };
}

function customerSelect() {
  return {
    id: customers.id,
    name: customers.name,
    email: customers.email,
    phone: customers.phone,
    billingLine1: customers.billingLine1,
    billingLine2: customers.billingLine2,
    billingCity: customers.billingCity,
    billingRegion: customers.billingRegion,
    billingPostcode: customers.billingPostcode,
    billingCountry: customers.billingCountry,
    shipLine1: customers.shipLine1,
    shipLine2: customers.shipLine2,
    shipCity: customers.shipCity,
    shipRegion: customers.shipRegion,
    shipPostcode: customers.shipPostcode,
    shipCountry: customers.shipCountry,
  };
}

function supplierSelect() {
  return {
    id: suppliers.id,
    name: suppliers.name,
    email: suppliers.email,
    phone: suppliers.phone,
    billingLine1: suppliers.billingLine1,
    billingLine2: suppliers.billingLine2,
    billingCity: suppliers.billingCity,
    billingRegion: suppliers.billingRegion,
    billingPostcode: suppliers.billingPostcode,
    billingCountry: suppliers.billingCountry,
  };
}

const key = normalizeProviderKey;

function addExistingToMaps<T extends ExistingCustomer | ExistingSupplier>(
  row: T,
  maps: {
    byXeroContactId: Map<string, T>;
    byEmail: Map<string, T>;
    byName: Map<string, T>;
  }
) {
  const xeroContactId = key(row.xeroContactId);
  const email = key(row.email);
  const name = key(row.name);

  if (xeroContactId) maps.byXeroContactId.set(xeroContactId, row);
  if (email) maps.byEmail.set(email, row);
  if (name) maps.byName.set(name, row);
}

async function loadExistingContactMapsInTx(
  tx: Tx,
  entityType: ContactImportEntity
) {
  const maps = {
    byXeroContactId: new Map<string, ExistingCustomer | ExistingSupplier>(),
    byEmail: new Map<string, ExistingCustomer | ExistingSupplier>(),
    byName: new Map<string, ExistingCustomer | ExistingSupplier>(),
  };

  const baseRows =
    entityType === "customers"
      ? await tx
          .select(customerSelect())
          .from(customers)
          .where(isNull(customers.deletedAt))
      : await tx
          .select(supplierSelect())
          .from(suppliers)
          .where(isNull(suppliers.deletedAt));

  const localRecordIds = baseRows.map((row) => row.id);
  const externalRows =
    localRecordIds.length === 0
      ? []
      : await tx
          .select({
            localRecordId: integrationExternalRecords.localRecordId,
            externalId: integrationExternalRecords.externalId,
            externalCode: integrationExternalRecords.externalCode,
            metadata: integrationExternalRecords.metadata,
            externalUpdatedAt: integrationExternalRecords.externalUpdatedAt,
          })
          .from(integrationExternalRecords)
          .where(
            and(
              eq(integrationExternalRecords.provider, XERO_PROVIDER),
              eq(
                integrationExternalRecords.entityType,
                entityType === "customers" ? "customer" : "supplier"
              ),
              inArray(integrationExternalRecords.localRecordId, localRecordIds)
            )
          );
  const externalByLocalId = new Map(
    externalRows.map((row) => [row.localRecordId, row])
  );
  const rows = baseRows.map((row) => {
    const external = externalByLocalId.get(row.id);
    const metadata = external?.metadata ?? {};
    return {
      ...row,
      xeroContactId: external?.externalId ?? null,
      xeroContactNumber: external?.externalCode ?? null,
      xeroAccountNumber:
        typeof metadata.accountNumber === "string" ? metadata.accountNumber : null,
      xeroPurchasesDefaultAccountCode:
        typeof metadata.purchasesDefaultAccountCode === "string"
          ? metadata.purchasesDefaultAccountCode
          : null,
      xeroAccountsPayableTaxType:
        typeof metadata.accountsPayableTaxType === "string"
          ? metadata.accountsPayableTaxType
          : null,
      xeroUpdatedAt: external?.externalUpdatedAt ?? null,
    };
  });

  for (const row of rows) {
    addExistingToMaps(row, maps);
  }

  return maps;
}

function findExistingInMaps(maps: ExistingContactMaps, contact: Contact) {
  const xeroContactId = key(contact.contactID);
  const email = key(contact.emailAddress);
  const name = key(contact.name);

  if (xeroContactId) {
    const row = maps.byXeroContactId.get(xeroContactId);
    if (row) return row;
  }

  if (email) {
    const row = maps.byEmail.get(email);
    if (row) return row;
  }

  return name ? maps.byName.get(name) ?? null : null;
}

export async function previewXeroContactImport(
  orgId: string,
  entityType: ContactImportEntity
): Promise<ContactImportPreview> {
  const fetched = await fetchAllContacts(orgId);

  return withOrgContext(orgId, async (tx) => {
    const preview: ContactImportPreview = {
      entityType,
      tenantName: fetched.tenantName,
      isDemoCompany: isDemoCompanyTenant(fetched.tenantName),
      totalFetched: fetched.contacts.length,
      toCreate: 0,
      toUpdate: 0,
      skipped: 0,
      errors: [],
      sampleCreates: [],
      sampleUpdates: [],
      sampleSkipped: [],
    };
    const existingMaps = await loadExistingContactMapsInTx(tx, entityType);

    for (const contact of fetched.contacts) {
      const contactName = cleanString(contact.name);
      if (!contactName) {
        preview.skipped += 1;
        preview.sampleSkipped.push("(unnamed)");
        continue;
      }

      try {
        const existing = findExistingInMaps(existingMaps, contact);
        if (existing) {
          preview.toUpdate += 1;
          preview.sampleUpdates.push(contactName);
        } else if (!isXeroEntity(contact, entityType)) {
          preview.skipped += 1;
          preview.sampleSkipped.push(contactName);
        } else {
          preview.toCreate += 1;
          preview.sampleCreates.push(contactName);
        }
      } catch (error) {
        preview.errors.push(
          `${contactName}: ${extractXeroMessage(error)}`
        );
        preview.skipped += 1;
      }
    }

    preview.sampleCreates = preview.sampleCreates.slice(0, 5);
    preview.sampleUpdates = preview.sampleUpdates.slice(0, 5);
    preview.sampleSkipped = preview.sampleSkipped.slice(0, 5);
    return preview;
  });
}

function assertDemoImportAllowed(tenantName: string, allowDemoCompany: boolean) {
  if (
    process.env.NODE_ENV === "production" &&
    isDemoCompanyTenant(tenantName) &&
    !allowDemoCompany
  ) {
    throw new XeroError(
      "This is Xero Demo Company. Confirm the demo import explicitly before importing.",
      409
    );
  }
}

export async function importContactsFromXero(
  orgId: string,
  entityType: ContactImportEntity,
  options?: { allowDemoCompany?: boolean }
): Promise<ImportResult> {
  const fetched = await fetchAllContacts(orgId);
  assertDemoImportAllowed(
    fetched.tenantName,
    options?.allowDemoCompany ?? false
  );

  return withOrgContext(orgId, async (tx) => {
    const [run] = await tx
      .insert(integrationImportRuns)
      .values({
        organizationId: orgId,
        provider: XERO_PROVIDER,
        entityType,
        tenantId: fetched.tenantId,
        tenantName: fetched.tenantName,
      })
      .returning({ id: integrationImportRuns.id });

    const result: ImportResult = {
      runId: run.id,
      tenantName: fetched.tenantName,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    const existingMaps = await loadExistingContactMapsInTx(tx, entityType);

    for (const contact of fetched.contacts) {
      const contactName = cleanString(contact.name);
      if (!contactName) {
        result.skipped += 1;
        continue;
      }

      try {
        const existing = findExistingInMaps(existingMaps, contact);
        if (!existing && !isXeroEntity(contact, entityType)) {
          result.skipped += 1;
          continue;
        }

        await tx.transaction(async (rowTx) => {
          const imported =
            entityType === "customers"
              ? await importCustomerInTx(
                  rowTx,
                  orgId,
                  run.id,
                  contact,
                  existing as ExistingCustomer | null,
                  result
                )
              : await importSupplierInTx(
                  rowTx,
                  orgId,
                  run.id,
                  contact,
                  existing as ExistingSupplier | null,
                  result
                );

          if (imported) {
            addExistingToMaps(imported, existingMaps);
          }
        });
      } catch (error) {
        console.error("Xero contact import row failed:", redactXeroError(error));
        result.errors.push(
          `${contactName}: ${extractXeroMessage(error)}`
        );
        result.skipped += 1;
      }
    }

    await tx
      .update(integrationImportRuns)
      .set({
        createdCount: result.created,
        updatedCount: result.updated,
        skippedCount: result.skipped,
        errorCount: result.errors.length,
        updatedAt: new Date(),
      })
      .where(eq(integrationImportRuns.id, run.id));

    return result;
  });
}

async function upsertExternalContactRecordInTx(
  tx: Tx,
  orgId: string,
  entityType: "customer" | "supplier",
  localRecordId: string,
  contact: Contact
) {
  await upsertExternalRecordInTx(tx, {
    organizationId: orgId,
    provider: XERO_PROVIDER,
    entityType,
    localRecordId,
    externalId: cleanString(contact.contactID),
    externalCode: cleanString(contact.contactNumber, 100),
    externalName: cleanString(contact.name),
    metadata: {
      accountNumber: cleanString(contact.accountNumber, 100),
      purchasesDefaultAccountCode: cleanString(contact.purchasesDefaultAccountCode, 20),
      accountsPayableTaxType: cleanString(contact.accountsPayableTaxType, 50),
      isCustomer: contact.isCustomer === true,
      isSupplier: contact.isSupplier === true,
    },
    externalUpdatedAt: cleanDate(contact.updatedDateUTC),
  });
}

async function importCustomerInTx(
  tx: Tx,
  orgId: string,
  runId: string,
  contact: Contact,
  existing: ExistingCustomer | null,
  result: ImportResult
): Promise<ExistingCustomer | null> {
  const addr = mapCustomerAddresses(contact);
  const nextData = {
    name: cleanString(contact.name) ?? existing?.name ?? "",
    email: cleanString(contact.emailAddress) ?? existing?.email ?? null,
    phone: mapPhone(contact) ?? existing?.phone ?? null,
    billingLine1: addr.billingLine1 ?? existing?.billingLine1 ?? null,
    billingLine2: addr.billingLine2 ?? existing?.billingLine2 ?? null,
    billingCity: addr.billingCity ?? existing?.billingCity ?? null,
    billingRegion: addr.billingRegion ?? existing?.billingRegion ?? null,
    billingPostcode: addr.billingPostcode ?? existing?.billingPostcode ?? null,
    billingCountry: addr.billingCountry ?? existing?.billingCountry ?? null,
    shipLine1: addr.shipLine1 ?? existing?.shipLine1 ?? null,
    shipLine2: addr.shipLine2 ?? existing?.shipLine2 ?? null,
    shipCity: addr.shipCity ?? existing?.shipCity ?? null,
    shipRegion: addr.shipRegion ?? existing?.shipRegion ?? null,
    shipPostcode: addr.shipPostcode ?? existing?.shipPostcode ?? null,
    shipCountry: addr.shipCountry ?? existing?.shipCountry ?? null,
  };

  if (existing) {
    await tx
      .update(customers)
      .set({ ...nextData, updatedAt: new Date() })
      .where(eq(customers.id, existing.id));
    await upsertExternalContactRecordInTx(tx, orgId, "customer", existing.id, contact);
    await tx.insert(integrationImportRunRows).values({
      organizationId: orgId,
      provider: XERO_PROVIDER,
      runId,
      entityType: "customers",
      action: "updated",
      localRecordId: existing.id,
      externalRecordId: contact.contactID ?? null,
      localName: nextData.name,
      previousData: customerSnapshot(existing),
    });
    result.updated += 1;
    return { id: existing.id, xeroContactId: contact.contactID ?? null, ...nextData };
  }

  const [created] = await tx
    .insert(customers)
    .values({ organizationId: orgId, ...nextData })
    .returning({ id: customers.id });
  await upsertExternalContactRecordInTx(tx, orgId, "customer", created.id, contact);
  await tx.insert(integrationImportRunRows).values({
    organizationId: orgId,
    provider: XERO_PROVIDER,
    runId,
    entityType: "customers",
    action: "created",
    localRecordId: created.id,
    externalRecordId: contact.contactID ?? null,
    localName: nextData.name,
    previousData: null,
  });
  result.created += 1;
  return { id: created.id, xeroContactId: contact.contactID ?? null, ...nextData };
}

async function importSupplierInTx(
  tx: Tx,
  orgId: string,
  runId: string,
  contact: Contact,
  existing: ExistingSupplier | null,
  result: ImportResult
): Promise<ExistingSupplier | null> {
  const addr = mapSupplierAddresses(contact);
  const nextData = {
    name: cleanString(contact.name) ?? existing?.name ?? "",
    email: cleanString(contact.emailAddress) ?? existing?.email ?? null,
    phone: mapPhone(contact) ?? existing?.phone ?? null,
    billingLine1: addr.billingLine1 ?? existing?.billingLine1 ?? null,
    billingLine2: addr.billingLine2 ?? existing?.billingLine2 ?? null,
    billingCity: addr.billingCity ?? existing?.billingCity ?? null,
    billingRegion: addr.billingRegion ?? existing?.billingRegion ?? null,
    billingPostcode: addr.billingPostcode ?? existing?.billingPostcode ?? null,
    billingCountry: addr.billingCountry ?? existing?.billingCountry ?? null,
  };

  if (existing) {
    await tx
      .update(suppliers)
      .set({ ...nextData, updatedAt: new Date() })
      .where(eq(suppliers.id, existing.id));
    await upsertExternalContactRecordInTx(tx, orgId, "supplier", existing.id, contact);
    await tx.insert(integrationImportRunRows).values({
      organizationId: orgId,
      provider: XERO_PROVIDER,
      runId,
      entityType: "suppliers",
      action: "updated",
      localRecordId: existing.id,
      externalRecordId: contact.contactID ?? null,
      localName: nextData.name,
      previousData: supplierSnapshot(existing),
    });
    result.updated += 1;
    return { id: existing.id, xeroContactId: contact.contactID ?? null, ...nextData };
  }

  const [created] = await tx
    .insert(suppliers)
    .values({ organizationId: orgId, ...nextData })
    .returning({ id: suppliers.id });
  await upsertExternalContactRecordInTx(tx, orgId, "supplier", created.id, contact);
  await tx.insert(integrationImportRunRows).values({
    organizationId: orgId,
    provider: XERO_PROVIDER,
    runId,
    entityType: "suppliers",
    action: "created",
    localRecordId: created.id,
    externalRecordId: contact.contactID ?? null,
    localName: nextData.name,
    previousData: null,
  });
  result.created += 1;
  return { id: created.id, xeroContactId: contact.contactID ?? null, ...nextData };
}

async function loadUndoPreviewInTx(
  tx: Tx,
  runId: string
): Promise<ImportUndoPreview> {
  const [run] = await tx
    .select()
    .from(integrationImportRuns)
    .where(eq(integrationImportRuns.id, runId));

  if (!run) {
    throw new XeroError("Xero import run not found.", 404);
  }
  if (run.entityType !== "customers" && run.entityType !== "suppliers") {
    throw new XeroError("Only customer and supplier imports can be reset.", 409);
  }

  const rows = await tx
    .select({
      action: integrationImportRunRows.action,
      localRecordId: integrationImportRunRows.localRecordId,
      localName: integrationImportRunRows.localName,
    })
    .from(integrationImportRunRows)
    .where(eq(integrationImportRunRows.runId, runId));

  const ids = rows
    .map((row) => row.localRecordId)
    .filter((id): id is string => id != null);
  const blockedIds =
    ids.length === 0
      ? new Set<string>()
      : run.entityType === "customers"
        ? await loadReferencedCustomerIdsInTx(tx, ids)
        : await loadReferencedSupplierIdsInTx(tx, ids);
  const blockedNames = rows
    .filter((row) => row.localRecordId != null && blockedIds.has(row.localRecordId))
    .map((row) => row.localName);

  return {
    runId,
    entityType: run.entityType,
    tenantName: run.tenantName,
    status: run.status,
    createdRows: rows.filter((row) => row.action === "created").length,
    updatedRows: rows.filter((row) => row.action === "updated").length,
    blockedRows: blockedIds.size,
    canUndo: run.status === "completed" && blockedIds.size === 0,
    sampleNames: rows.map((row) => row.localName).slice(0, 5),
    blockedNames: blockedNames.slice(0, 5),
  };
}

async function loadReferencedCustomerIdsInTx(tx: Tx, ids: string[]) {
  const rows = await tx
    .select({ id: salesOrders.customerId })
    .from(salesOrders)
    .where(
      and(
        inArray(salesOrders.customerId, ids),
        eq(salesOrders.status, "open"),
        isNull(salesOrders.deletedAt)
      )
    );
  return new Set(rows.map((row) => row.id).filter((id): id is string => id != null));
}

async function loadReferencedSupplierIdsInTx(tx: Tx, ids: string[]) {
  const rows = await tx
    .select({ id: purchaseOrders.supplierId })
    .from(purchaseOrders)
    .where(
      and(
        inArray(purchaseOrders.supplierId, ids),
        inArray(purchaseOrders.status, ["not_received", "partial"]),
        isNull(purchaseOrders.deletedAt)
      )
    );
  return new Set(rows.map((row) => row.id).filter((id): id is string => id != null));
}

export async function previewXeroImportUndo(
  orgId: string,
  runId: string
): Promise<ImportUndoPreview> {
  return withOrgContext(orgId, (tx) => loadUndoPreviewInTx(tx, runId));
}

export async function getXeroImportRunEntityType(
  orgId: string,
  runId: string
): Promise<ContactImportEntity> {
  return withOrgContext(orgId, async (tx) => {
    const [run] = await tx
      .select({ entityType: integrationImportRuns.entityType })
      .from(integrationImportRuns)
      .where(eq(integrationImportRuns.id, runId));

    if (!run) {
      throw new XeroError("Xero import run not found.", 404);
    }
    if (run.entityType !== "customers" && run.entityType !== "suppliers") {
      throw new XeroError("Only customer and supplier imports can be reset.", 409);
    }

    return run.entityType;
  });
}

async function lockUndoTargetRowsInTx(
  tx: Tx,
  entityType: ContactImportEntity,
  ids: string[]
) {
  if (ids.length === 0) {
    return;
  }

  if (entityType === "customers") {
    await tx
      .select({ id: customers.id })
      .from(customers)
      .where(inArray(customers.id, ids))
      .for("update");
    return;
  }

  await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(inArray(suppliers.id, ids))
    .for("update");
}

export async function undoXeroImportRun(
  orgId: string,
  runId: string
): Promise<ImportUndoResult> {
  return withOrgContext(orgId, async (tx) => {
    const [lockedRun] = await tx
      .select()
      .from(integrationImportRuns)
      .where(eq(integrationImportRuns.id, runId))
      .for("update");

    if (!lockedRun) {
      throw new XeroError("Xero import run not found.", 404);
    }
    if (
      lockedRun.entityType !== "customers" &&
      lockedRun.entityType !== "suppliers"
    ) {
      throw new XeroError("Only customer and supplier imports can be reset.", 409);
    }
    if (lockedRun.status !== "completed") {
      throw new XeroError("This Xero import run has already been reset.", 409);
    }

    const rows = await tx
      .select()
      .from(integrationImportRunRows)
      .where(eq(integrationImportRunRows.runId, runId));
    await lockUndoTargetRowsInTx(
      tx,
      lockedRun.entityType,
      rows
        .map((row) => row.localRecordId)
        .filter((id): id is string => id != null)
    );

    const preview = await loadUndoPreviewInTx(tx, runId);
    if (!preview.canUndo) {
      throw new XeroError(
        "This Xero import cannot be reset because imported rows are referenced by orders.",
        409
      );
    }

    const now = new Date();
    let undoneCreatedRows = 0;
    let restoredUpdatedRows = 0;

    for (const row of rows) {
      if (!row.localRecordId) {
        continue;
      }

      if (lockedRun.entityType === "customers") {
        if (row.action === "created") {
          await tx
            .update(customers)
            .set({ deletedAt: now, updatedAt: now })
            .where(eq(customers.id, row.localRecordId));
          undoneCreatedRows += 1;
        } else {
          const previous = row.previousData as CustomerSnapshot | null;
          if (previous) {
            await tx
              .update(customers)
              .set({ ...previous, updatedAt: now })
              .where(eq(customers.id, row.localRecordId));
            restoredUpdatedRows += 1;
          }
        }
      } else if (row.action === "created") {
        await tx
          .update(suppliers)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(suppliers.id, row.localRecordId));
        undoneCreatedRows += 1;
      } else {
        const previous = row.previousData as SupplierSnapshot | null;
        if (previous) {
          await tx
            .update(suppliers)
            .set({ ...previous, updatedAt: now })
            .where(eq(suppliers.id, row.localRecordId));
          restoredUpdatedRows += 1;
        }
      }
    }

    await tx
      .update(integrationImportRuns)
      .set({ status: "undone", undoneAt: now, updatedAt: now })
      .where(eq(integrationImportRuns.id, runId));

    return {
      ...preview,
      status: "undone",
      canUndo: false,
      undoneCreatedRows,
      restoredUpdatedRows,
    };
  });
}

export async function importCustomersFromXero(
  orgId: string,
  options?: { allowDemoCompany?: boolean }
): Promise<ImportResult> {
  return importContactsFromXero(orgId, "customers", options);
}

export async function importSuppliersFromXero(
  orgId: string,
  options?: { allowDemoCompany?: boolean }
): Promise<ImportResult> {
  return importContactsFromXero(orgId, "suppliers", options);
}
