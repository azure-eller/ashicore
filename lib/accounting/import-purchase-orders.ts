import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  accountingDocumentSyncs,
  accountingClassifications,
  integrationConnections,
  integrationExternalRecords,
  integrationImportRunRows,
  integrationImportRuns,
  itemFamilies,
  items,
  organization,
  purchaseOrders,
  suppliers,
  supplierItems,
  unitDefinitions,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { normalizeAddressFields, normalizeNumeric } from "@/lib/format";
import {
  ACCOUNTING_PROVIDER_XERO,
  type AccountingProvider,
} from "@/lib/accounting/constants";
import {
  getAccountingConnector,
  isAccountingProvider,
} from "@/lib/accounting/providers";
import { ACCOUNTING_DOCUMENT_PURCHASE_ORDER } from "@/lib/accounting/sync-state";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";
import {
  classifyImportedPurchaseOrderChargeLine,
  isImportedPurchaseOrderChargeLine,
} from "@/lib/accounting/purchase-order-line-classification";
import { cleanString } from "@/lib/accounting/providers/common";
import type {
  ExternalPurchaseOrderDocument,
  ExternalPurchaseOrderFetchResult,
  ExternalPurchaseOrderLine,
} from "@/lib/accounting/providers/types";
import {
  upsertImportedAccountingPurchaseOrderInTx,
  type ImportedAccountingPurchaseOrder,
} from "@/app/(dashboard)/purchasing/queries";

const DEFAULT_SINCE_DATE = "2024-01-01";

export type AccountingPurchaseOrderImportCandidate = {
  id: string;
  status: "ready" | "creates_records" | "excluded";
  selectedByDefault: boolean;
  selectable: boolean;
  exclusionReason: string | null;
  externalPurchaseOrderId: string;
  externalPurchaseOrderNumber: string;
  externalStatus: string;
  supplierName: string;
  supplierMatched: boolean;
  createsSupplier: boolean;
  createsMaterials: number;
  needsPurchaseConversionReview: number;
  reviewReason: string | null;
  lineCount: number;
  matchedLineCount: number;
  orderDate: string | null;
  deliveryDate: string | null;
  total: string | null;
};

export type AccountingPurchaseOrderImportPreview = {
  tenantName: string;
  sinceDate: string;
  totalExternalPurchaseOrders: number;
  summary: {
    ready: number;
    createsRecords: number;
    excluded: number;
    selectedByDefault: number;
  };
  candidates: AccountingPurchaseOrderImportCandidate[];
};

export type AccountingPurchaseOrderImportResult = {
  runId: string;
  tenantName: string;
  created: number;
  updated: number;
  createdSuppliers: number;
  createdItems: number;
  protected: number;
  skipped: number;
  errors: string[];
};

type AutoSyncSkip = {
  externalPurchaseOrderId: string;
  externalPurchaseOrderNumber: string;
  reason: string;
};

type StaleImportedOpenPurchaseOrder = {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  externalPurchaseOrderId: string;
  externalPurchaseOrderNumber: string | null;
  status: string;
};

function normalizeKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizeMoneyValue(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return normalizeNumeric(value);
}

async function fetchOpenProviderPurchaseOrders(
  orgId: string,
  provider: AccountingProvider
) {
  return getAccountingConnector(provider).fetchOpenPurchaseOrders(orgId);
}

async function loadLocalMatchesInTx(tx: Tx, provider: AccountingProvider) {
  const [supplierRows, itemRows, externalRows] = await Promise.all([
    tx
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(isNull(suppliers.deletedAt)),
    tx
      .select({
        id: items.id,
        name: sql<string>`COALESCE(${itemFamilies.name}, ${items.name})`,
        sku: items.sku,
        purchaseToStockFactor: sql<string | null>`COALESCE(${itemFamilies.purchaseToStockFactor}, ${items.purchaseToStockFactor})`,
      })
      .from(items)
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(and(eq(items.itemType, "material"), isNull(items.deletedAt))),
    tx
      .select({
        entityType: integrationExternalRecords.entityType,
        localRecordId: integrationExternalRecords.localRecordId,
        externalId: integrationExternalRecords.externalId,
        externalCode: integrationExternalRecords.externalCode,
      })
      .from(integrationExternalRecords)
      .where(eq(integrationExternalRecords.provider, provider)),
  ]);

  const supplierByName = new Map(
    supplierRows.map((supplier) => [normalizeKey(supplier.name)!, supplier])
  );
  const supplierByExternalId = new Map(
    externalRows
      .filter((row) => row.entityType === "supplier" && row.externalId)
      .map((row) => [normalizeKey(row.externalId)!, row.localRecordId])
  );
  const itemBySku = new Map(
    itemRows
      .filter((item) => item.sku)
      .map((item) => [normalizeKey(item.sku)!, item])
  );
  const itemByName = new Map(
    itemRows.map((item) => [normalizeKey(item.name)!, item])
  );
  const itemByExternalCode = new Map(
    externalRows
      .filter((row) => row.entityType === "item" && row.externalCode)
      .map((row) => [normalizeKey(row.externalCode)!, row.localRecordId])
  );

  return {
    suppliers: supplierRows,
    items: itemRows,
    supplierByName,
    supplierByExternalId,
    itemBySku,
    itemByName,
    itemByExternalCode,
  };
}

function findSupplierId(
  order: ExternalPurchaseOrderDocument,
  local: Awaited<ReturnType<typeof loadLocalMatchesInTx>>
) {
  const byExternalId = order.supplierContactId
    ? local.supplierByExternalId.get(normalizeKey(order.supplierContactId)!)
    : null;
  if (byExternalId) return byExternalId;
  return local.supplierByName.get(normalizeKey(order.supplierName)!)?.id ?? null;
}

function findItemId(
  line: ExternalPurchaseOrderLine,
  local: Awaited<ReturnType<typeof loadLocalMatchesInTx>>
) {
  const itemCode = normalizeKey(line.itemCode);
  if (itemCode) {
    const bySku = local.itemBySku.get(itemCode);
    if (bySku) return bySku.id;
    const byExternalCode = local.itemByExternalCode.get(itemCode);
    if (byExternalCode) return byExternalCode;
  }
  const name = normalizeKey(line.description);
  return name ? local.itemByName.get(name)?.id ?? null : null;
}

function findItem(
  line: ExternalPurchaseOrderLine,
  local: Awaited<ReturnType<typeof loadLocalMatchesInTx>>
) {
  const itemId = findItemId(line, local);
  return itemId ? local.items.find((item) => item.id === itemId) ?? null : null;
}

function lineNeedsPurchaseConversionReview(
  line: ExternalPurchaseOrderLine,
  local: Awaited<ReturnType<typeof loadLocalMatchesInTx>>
) {
  const item = findItem(line, local);
  return item != null && item.purchaseToStockFactor == null;
}

function duplicateMaterialLineReason(
  materialLines: ExternalPurchaseOrderLine[],
  local: Awaited<ReturnType<typeof loadLocalMatchesInTx>>
) {
  const matchedItemIds = materialLines
    .map((line) => findItemId(line, local))
    .filter((id): id is string => id != null);
  if (new Set(matchedItemIds).size !== matchedItemIds.length) {
    return "Multiple provider lines map to the same ERP material";
  }

  const providerKeys = materialLines
    .map((line) => normalizeKey(line.itemCode) ?? normalizeKey(line.description))
    .filter((key): key is string => key != null);
  if (new Set(providerKeys).size !== providerKeys.length) {
    return "Multiple provider lines use the same item code or description";
  }

  return null;
}

function isImportableLine(line: ExternalPurchaseOrderLine) {
  return (
    line.quantity != null &&
    Number.isFinite(line.quantity) &&
    line.quantity > 0 &&
    line.unitAmount != null &&
    Number.isFinite(line.unitAmount) &&
    line.unitAmount >= 0 &&
    Boolean(cleanString(line.description) ?? cleanString(line.itemCode))
  );
}

function buildCandidate(
  order: ExternalPurchaseOrderDocument,
  local: Awaited<ReturnType<typeof loadLocalMatchesInTx>>
): AccountingPurchaseOrderImportCandidate {
  const importableLines = order.lines.filter(isImportableLine);
  const materialLines = importableLines.filter(
    (line) => !isImportedPurchaseOrderChargeLine(line)
  );
  const supplierId = findSupplierId(order, local);
  const matchedLineCount = materialLines.filter((line) =>
    findItemId(line, local)
  ).length;
  const createsMaterials = materialLines.length - matchedLineCount;
  const duplicateReason = duplicateMaterialLineReason(materialLines, local);
  const needsPurchaseConversionReview = materialLines.filter((line) =>
    lineNeedsPurchaseConversionReview(line, local)
  ).length;
  const reviewReason =
    needsPurchaseConversionReview > 0
      ? "Set purchase conversion before auto-sync"
      : null;
  const exclusionReason =
    materialLines.length === 0
      ? "No material lines with quantity and price"
      : duplicateReason;
  const status = exclusionReason
    ? "excluded"
    : supplierId && createsMaterials === 0 && needsPurchaseConversionReview === 0
      ? "ready"
      : "creates_records";

  return {
    id: order.id,
    status,
    selectedByDefault: status === "ready",
    selectable: status !== "excluded",
    exclusionReason,
    externalPurchaseOrderId: order.id,
    externalPurchaseOrderNumber: order.number,
    externalStatus: order.status,
    supplierName: order.supplierName,
    supplierMatched: supplierId != null,
    createsSupplier: supplierId == null,
    createsMaterials,
    needsPurchaseConversionReview,
    reviewReason,
    lineCount: importableLines.length,
    matchedLineCount,
    orderDate: order.date,
    deliveryDate: order.deliveryDate,
    total: normalizeMoneyValue(order.total),
  };
}

function selectAutoSyncOrdersForImport(
  orders: ExternalPurchaseOrderDocument[],
  local: Awaited<ReturnType<typeof loadLocalMatchesInTx>>
) {
  const selectedIds: string[] = [];
  const skipped: AutoSyncSkip[] = [];

  for (const order of orders) {
    const importableLines = order.lines.filter(isImportableLine);
    const materialLines = importableLines.filter(
      (line) => !isImportedPurchaseOrderChargeLine(line)
    );

    if (materialLines.length === 0) {
      skipped.push({
        externalPurchaseOrderId: order.id,
        externalPurchaseOrderNumber: order.number,
        reason: "No material lines with quantity and price.",
      });
      continue;
    }

    const matchedItemIds = materialLines.map((line) => findItemId(line, local));
    const duplicateReason = duplicateMaterialLineReason(materialLines, local);
    if (duplicateReason) {
      skipped.push({
        externalPurchaseOrderId: order.id,
        externalPurchaseOrderNumber: order.number,
        reason: `${duplicateReason}. Review and import manually after combining the lines in Xero or ERP.`,
      });
      continue;
    }

    if (materialLines.some((line) => lineNeedsPurchaseConversionReview(line, local))) {
      skipped.push({
        externalPurchaseOrderId: order.id,
        externalPurchaseOrderNumber: order.number,
        reason:
          "One or more matched materials do not have a purchase-to-stock conversion set. Review manually so provider quantities convert into ERP stocking units correctly.",
      });
      continue;
    }

    if (matchedItemIds.some((id) => id == null)) {
      skipped.push({
        externalPurchaseOrderId: order.id,
        externalPurchaseOrderNumber: order.number,
        reason:
          "One or more lines would create a new material. Review and import manually so the stocking unit and purchase conversion are set correctly.",
      });
      continue;
    }

    selectedIds.push(order.id);
  }

  return { selectedIds, skipped };
}

async function listImportedOpenPurchaseOrdersMissingFromProviderInTx(
  tx: Tx,
  provider: AccountingProvider,
  openExternalIds: Set<string>
): Promise<StaleImportedOpenPurchaseOrder[]> {
  const rows = await tx
    .select({
      purchaseOrderId: purchaseOrders.id,
      purchaseOrderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
      externalPurchaseOrderId: accountingDocumentSyncs.externalDocumentId,
      externalPurchaseOrderNumber: accountingDocumentSyncs.externalDocumentNumber,
    })
    .from(accountingDocumentSyncs)
    .innerJoin(purchaseOrders, eq(accountingDocumentSyncs.documentId, purchaseOrders.id))
    .where(
      and(
        eq(accountingDocumentSyncs.provider, provider),
        eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_ORDER),
        isNull(purchaseOrders.deletedAt)
      )
    );

  return rows
    .filter(
      (row) =>
        row.externalPurchaseOrderId != null &&
        ["draft", "ordered", "partial"].includes(row.status) &&
        !openExternalIds.has(row.externalPurchaseOrderId)
    )
    .map((row) => ({
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderNumber: row.purchaseOrderNumber,
      externalPurchaseOrderId: row.externalPurchaseOrderId!,
      externalPurchaseOrderNumber: row.externalPurchaseOrderNumber,
      status: row.status,
    }));
}

export async function previewAccountingPurchaseOrderImport(
  orgId: string,
  provider: AccountingProvider = ACCOUNTING_PROVIDER_XERO
): Promise<AccountingPurchaseOrderImportPreview> {
  const providerData = await fetchOpenProviderPurchaseOrders(orgId, provider);
  return withOrgContext(orgId, async (tx) => {
    const local = await loadLocalMatchesInTx(tx, provider);
    const candidates = providerData.purchaseOrders.map((order) =>
      buildCandidate(order, local)
    );
    return {
      tenantName: providerData.tenantName,
      sinceDate: DEFAULT_SINCE_DATE,
      totalExternalPurchaseOrders: providerData.purchaseOrders.length,
      summary: {
        ready: candidates.filter((candidate) => candidate.status === "ready").length,
        createsRecords: candidates.filter(
          (candidate) => candidate.status === "creates_records"
        ).length,
        excluded: candidates.filter((candidate) => candidate.status === "excluded").length,
        selectedByDefault: candidates.filter((candidate) => candidate.selectedByDefault)
          .length,
      },
      candidates,
    };
  });
}

async function getOrCreateEachUnitInTx(tx: Tx, orgId: string) {
  const [existing] = await tx
    .select({ id: unitDefinitions.id })
    .from(unitDefinitions)
    .where(
      and(
        eq(unitDefinitions.organizationId, orgId),
        eq(unitDefinitions.name, "Each"),
        eq(unitDefinitions.uom, "ea"),
        isNull(unitDefinitions.deletedAt)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(unitDefinitions)
    .values({ organizationId: orgId, name: "Each", size: "1", uom: "ea" })
    .returning({ id: unitDefinitions.id });
  return created.id;
}

async function getOrCreateSupplierInTx(
  tx: Tx,
  orgId: string,
  provider: AccountingProvider,
  order: ExternalPurchaseOrderDocument
) {
  const local = await loadLocalMatchesInTx(tx, provider);
  const existingId = findSupplierId(order, local);
  if (existingId) return { id: existingId, created: false };

  const [created] = await tx
    .insert(suppliers)
    .values({ organizationId: orgId, name: order.supplierName })
    .returning({ id: suppliers.id });

  if (order.supplierContactId) {
    await tx.insert(integrationExternalRecords).values({
      organizationId: orgId,
      provider,
      entityType: "supplier",
      localRecordId: created.id,
      externalId: order.supplierContactId,
      externalName: order.supplierName,
      lastSyncedAt: new Date(),
    });
  }
  return { id: created.id, created: true };
}

async function getOrCreateItemInTx(
  tx: Tx,
  orgId: string,
  provider: AccountingProvider,
  line: ExternalPurchaseOrderLine,
  local: Awaited<ReturnType<typeof loadLocalMatchesInTx>>
) {
  const existingId = findItemId(line, local);
  if (existingId) return { id: existingId, created: false };

  const unitDefinitionId = await getOrCreateEachUnitInTx(tx, orgId);
  const name =
    cleanString(line.description) ??
    cleanString(line.itemCode) ??
    "Imported accounting material";
  const defaultPurchasePrice = normalizeMoneyValue(line.unitAmount) ?? "0";
  const [created] = await tx
    .insert(items)
    .values({
      organizationId: orgId,
      name,
      description: cleanString(line.description, 1000),
      sku: null,
      itemType: "material",
      unitDefinitionId,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      safetyStock: "0",
      defaultPurchasePrice,
      currentStockUnitCost: defaultPurchasePrice,
      defaultSellingPrice: null,
      sellable: false,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
    })
    .returning({ id: items.id });

  await tx.insert(integrationExternalRecords).values({
    organizationId: orgId,
    provider,
    entityType: "item",
    localRecordId: created.id,
    externalCode: cleanString(line.itemCode, 100),
    externalName: name,
    externalDescription: cleanString(line.description, 1000),
    lastSyncedAt: new Date(),
  });

  return { id: created.id, created: true };
}

function parseDeliveryAddress(value: string | null) {
  const [line1, line2, cityRegionPostcode, country] =
    value?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  return normalizeAddressFields({
    line1,
    line2,
    city: cityRegionPostcode,
    region: null,
    postcode: null,
    country,
  });
}

async function buildPurchaseOrderPayloadInTx(
  tx: Tx,
  orgId: string,
  provider: AccountingProvider,
  order: ExternalPurchaseOrderDocument
) {
  const supplier = await getOrCreateSupplierInTx(tx, orgId, provider, order);
  let local = await loadLocalMatchesInTx(tx, provider);
  let createdItems = 0;
  const lines = [];

  const importableLines = order.lines.filter(isImportableLine);
  const materialLines = importableLines.filter(
    (line) => !isImportedPurchaseOrderChargeLine(line)
  );
  const additionalCosts = importableLines
    .map((line) => classifyImportedPurchaseOrderChargeLine(line))
    .filter((line): line is NonNullable<typeof line> => line != null);

  for (const line of materialLines) {
    const item = await getOrCreateItemInTx(tx, orgId, provider, line, local);
    if (item.created) {
      createdItems += 1;
      local = await loadLocalMatchesInTx(tx, provider);
    }

    const unitCost = normalizeMoneyValue(line.unitAmount) ?? "0";
    lines.push({
      itemId: item.id,
      quantityOrdered: normalizeNumeric(line.quantity ?? 0),
      unitCost,
      taxRateId: null,
      accountingPurchaseAccountCode: line.accountCode,
      shipAddressEntryId: null,
      shipContactName: null,
      shipContactPhone: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      shipDeliveryInstructions: null,
    });

    const [existingSupplierItem] = await tx
      .select({ id: supplierItems.id })
      .from(supplierItems)
      .where(
        and(
          eq(supplierItems.supplierId, supplier.id),
          eq(supplierItems.itemId, item.id),
          isNull(supplierItems.deletedAt)
        )
      )
      .limit(1);
    if (existingSupplierItem) {
      await tx
        .update(supplierItems)
        .set({
          supplierSku: line.itemCode,
          unitCost,
          updatedAt: new Date(),
        })
        .where(eq(supplierItems.id, existingSupplierItem.id));
    } else {
      await tx.insert(supplierItems).values({
        organizationId: orgId,
        supplierId: supplier.id,
        itemId: item.id,
        supplierSku: line.itemCode,
        unitCost,
        isPreferred: false,
      });
    }

    if (line.accountCode || line.taxType) {
      await tx
        .insert(accountingClassifications)
        .values({
          organizationId: orgId,
          provider,
          entityType: "item",
          localRecordId: item.id,
          accountCode: line.accountCode,
          taxType: line.taxType,
        })
        .onConflictDoUpdate({
          target: [
            accountingClassifications.organizationId,
            accountingClassifications.provider,
            accountingClassifications.entityType,
            accountingClassifications.localRecordId,
          ],
          set: {
            accountCode: line.accountCode,
            taxType: line.taxType,
            updatedAt: new Date(),
          },
        });
    }
  }

  const address = parseDeliveryAddress(order.deliveryAddress);
  const payload: ImportedAccountingPurchaseOrder = {
    accountingProvider: provider,
    orderNumber: order.number,
    externalPurchaseOrderId: order.id,
    externalPurchaseOrderNumber: order.number,
    orderedAt: order.date ? new Date(`${order.date}T00:00:00.000Z`) : null,
    supplierId: supplier.id,
    expectedDate: order.deliveryDate,
    shippingCost: "0",
    notes: "Imported from accounting provider.",
    accountingPurchaseAccountCode: null,
    shipLine1: address.line1,
    shipLine2: address.line2,
    shipCity: address.city,
    shipRegion: address.region,
    shipPostcode: address.postcode,
    shipCountry: address.country,
    lines,
    additionalCosts,
  };

  return {
    payload,
    createdSupplier: supplier.created,
    createdItems,
  };
}

export async function applyAccountingPurchaseOrderImport(
  orgId: string,
  candidateIds: string[],
  options: {
    actorUserId?: string | null;
    auto?: boolean;
    provider?: AccountingProvider;
    providerData?: ExternalPurchaseOrderFetchResult;
  } = {}
): Promise<AccountingPurchaseOrderImportResult> {
  const provider = options.provider ?? ACCOUNTING_PROVIDER_XERO;
  const connector = getAccountingConnector(provider);
  const providerData =
    options.providerData ?? (await fetchOpenProviderPurchaseOrders(orgId, provider));
  const selected = new Set(candidateIds);
  const selectedOrders = providerData.purchaseOrders.filter((order) => selected.has(order.id));

  return withOrgContext(orgId, async (tx) => {
    const [run] = await tx
      .insert(integrationImportRuns)
      .values({
        organizationId: orgId,
        provider,
        entityType: "purchase_orders",
        tenantId: providerData.tenantId,
        tenantName: providerData.tenantName,
      })
      .returning({ id: integrationImportRuns.id });

    let created = 0;
    let updated = 0;
    let protectedCount = 0;
    let createdSuppliers = 0;
    let createdItems = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const order of selectedOrders) {
      try {
        if (order.lines.filter(isImportableLine).length === 0) {
          skipped += 1;
          continue;
        }
        const built = await buildPurchaseOrderPayloadInTx(tx, orgId, provider, order);
        createdSuppliers += built.createdSupplier ? 1 : 0;
        createdItems += built.createdItems;
        const result = await upsertImportedAccountingPurchaseOrderInTx(
          tx,
          orgId,
          built.payload,
          { actorUserId: options.actorUserId ?? null }
        );
        if (result.action === "created") created += 1;
        else if (result.action === "updated") updated += 1;
        else skipped += 1;
        if (result.protected) protectedCount += 1;

        await tx.insert(integrationImportRunRows).values({
          organizationId: orgId,
          provider,
          runId: run.id,
          entityType: "purchase_orders",
          action: result.action === "created" ? "created" : "updated",
          localRecordId: result.id,
          externalRecordId: order.id,
          localName: order.number,
          previousData: null,
        });
      } catch (error) {
        errors.push(`${order.number}: ${connector.extractErrorMessage(error)}`);
        console.error(
          "Accounting purchase order import row failed:",
          connector.redactError(error)
        );
      }
    }

    await tx
      .update(integrationImportRuns)
      .set({
        createdCount: created,
        updatedCount: updated,
        skippedCount: skipped,
        errorCount: errors.length,
        updatedAt: new Date(),
      })
      .where(eq(integrationImportRuns.id, run.id));

    return {
      runId: run.id,
      tenantName: providerData.tenantName,
      created,
      updated,
      createdSuppliers,
      createdItems,
      protected: protectedCount,
      skipped,
      errors,
    };
  });
}

async function listAutoSyncTargets() {
  const orgs = await db
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.createdAt));
  const enabled: Array<{ orgId: string; provider: AccountingProvider }> = [];
  for (const { id } of orgs) {
    const rows = await withOrgContext(id, async (tx) =>
      tx
        .select({
          provider: integrationConnections.provider,
          enabled: integrationConnections.autoSyncPurchaseOrdersFromAccounting,
        })
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.organizationId, id),
            eq(integrationConnections.autoSyncPurchaseOrdersFromAccounting, true)
          )
        )
    );
    for (const row of rows) {
      if (isAccountingProvider(row.provider) && row.enabled) {
        enabled.push({ orgId: id, provider: row.provider });
      }
    }
  }
  return enabled;
}

export async function autoSyncAccountingPurchaseOrders() {
  const targets = await listAutoSyncTargets();
  const results: Array<{
    orgId: string;
    provider: AccountingProvider;
    result?: AccountingPurchaseOrderImportResult;
    skipped?: AutoSyncSkip[];
    staleOpenPurchaseOrders?: StaleImportedOpenPurchaseOrder[];
    error?: string;
  }> = [];
  for (const { orgId, provider } of targets) {
    try {
      const providerData = await fetchOpenProviderPurchaseOrders(orgId, provider);
      const autoSelection = await withOrgContext(orgId, async (tx) => {
        const local = await loadLocalMatchesInTx(tx, provider);
        const selected = selectAutoSyncOrdersForImport(
          providerData.purchaseOrders,
          local
        );
        const staleOpenPurchaseOrders =
          await listImportedOpenPurchaseOrdersMissingFromProviderInTx(
            tx,
            provider,
            new Set(providerData.purchaseOrders.map((order) => order.id))
          );
        return { ...selected, staleOpenPurchaseOrders };
      });
      const result = await applyAccountingPurchaseOrderImport(
        orgId,
        autoSelection.selectedIds,
        { auto: true, provider, providerData }
      );
      results.push({
        orgId,
        provider,
        result,
        skipped: autoSelection.skipped,
        staleOpenPurchaseOrders: autoSelection.staleOpenPurchaseOrders,
      });
      await tryRecordAccountingAuditEvent({
        organizationId: orgId,
        actor: { type: "process", processName: "accounting_purchase_order_sync" },
        eventType: "accounting_auto_sync",
        outcome: result.errors.length > 0 ? "failure" : "success",
        source: "GET /api/internal/accounting-purchase-order-sync",
        provider,
        localEntityType: "purchase_orders",
        localEntityId: result.runId,
        metadata: {
          fetched: providerData.purchaseOrders.length,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          protected: result.protected,
          errorCount: result.errors.length,
          errors: result.errors.slice(0, 10),
          autoSkippedCount: autoSelection.skipped.length,
          autoSkipped: autoSelection.skipped.slice(0, 10),
          staleOpenPurchaseOrderCount:
            autoSelection.staleOpenPurchaseOrders.length,
          staleOpenPurchaseOrders:
            autoSelection.staleOpenPurchaseOrders.slice(0, 10),
        },
      });
    } catch (error) {
      results.push({
        orgId,
        provider,
        error: getAccountingConnector(provider).extractErrorMessage(error),
      });
      await tryRecordAccountingAuditEvent({
        organizationId: orgId,
        actor: { type: "process", processName: "accounting_purchase_order_sync" },
        eventType: "accounting_auto_sync",
        outcome: "failure",
        source: "GET /api/internal/accounting-purchase-order-sync",
        provider,
        localEntityType: "purchase_orders",
        metadata: accountingAuditErrorMetadata(error),
      });
    }
  }
  return { totalOrgs: targets.length, results };
}
