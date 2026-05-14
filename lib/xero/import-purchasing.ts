import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import {
  accountingClassifications,
  integrationExternalRecords,
  integrationImportRunRows,
  integrationImportRuns,
  items,
  supplierItems,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/sync-state";
import type { Tx } from "@/lib/db/with-org-context";
import { withOrgContext } from "@/lib/db/with-org-context";
import { normalizeNumeric } from "@/lib/format";
import { trimScaleNullable } from "@/lib/db/numeric";
import { getAuthedXeroClient } from "./client";
import { XeroError, extractXeroMessage, redactXeroError } from "./errors";

const DEFAULT_SINCE_DATE = "2024-01-01";
const PAGE_SIZE = 100;
const MAX_PURCHASE_ORDER_PAGES = 20;
const MAX_BILL_PAGES = 10;

type LocalSupplier = {
  id: string;
  name: string;
  xeroContactId: string | null;
};

type LocalItem = {
  id: string;
  name: string;
  sku: string | null;
  xeroItemId: string | null;
  xeroItemCode: string | null;
  xeroItemName: string | null;
  xeroPurchaseDescription: string | null;
  defaultPurchasePrice: string | null;
};

type XeroItemSummary = {
  itemId: string | null;
  code: string | null;
  name: string | null;
  purchaseDescription: string | null;
  purchaseUnitPrice: number | null;
  purchaseAccountCode: string | null;
  purchaseTaxType: string | null;
  updatedAt: Date | null;
};

type SourceLine = {
  sourceType: "purchase_order" | "bill";
  sourceNumber: string | null;
  sourceDate: string | null;
  supplierContactId: string | null;
  supplierName: string | null;
  itemCode: string | null;
  description: string | null;
  unitAmount: number | null;
  accountCode: string | null;
  taxType: string | null;
};

export type XeroPurchasingCandidateStatus =
  | "ready"
  | "needs_item_match"
  | "needs_supplier_match"
  | "excluded";

export type XeroPurchasingCandidate = {
  id: string;
  status: XeroPurchasingCandidateStatus;
  selectedByDefault: boolean;
  selectable: boolean;
  exclusionReason: string | null;
  supplierId: string | null;
  supplierName: string;
  xeroSupplierContactId: string | null;
  itemId: string | null;
  itemName: string | null;
  itemSku: string | null;
  xeroItemId: string | null;
  xeroItemCode: string;
  xeroItemName: string | null;
  xeroPurchaseDescription: string | null;
  productKey: string;
  latestUnitCost: string | null;
  xeroItemUnitPrice: string | null;
  existingSupplierItemUnitCost: string | null;
  occurrences: number;
  latestDate: string | null;
  latestSource: string | null;
  accountingPurchaseAccountCode: string | null;
  xeroPurchaseTaxType: string | null;
};

export type XeroPurchasingSyncPreview = {
  tenantName: string;
  sinceDate: string;
  totalXeroPurchasedItems: number;
  totalSourceLines: number;
  summary: {
    ready: number;
    selectedByDefault: number;
    needsItemMatch: number;
    needsSupplierMatch: number;
    excluded: number;
  };
  candidates: XeroPurchasingCandidate[];
};

export type XeroPurchasingSyncApplyResult = {
  runId: string;
  tenantName: string;
  created: number;
  updated: number;
  createdSuppliers: number;
  createdItems: number;
  skipped: number;
  errors: string[];
};

function cleanString(value: string | null | undefined, maxLength = 255) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function cleanDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asDateString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = cleanDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function normalizeKey(value: string | null | undefined) {
  return cleanString(value)?.toLowerCase() ?? null;
}

function compactKey(value: string | null | undefined) {
  return cleanString(value)?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? null;
}

const ITEM_MATCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "bag",
  "bags",
  "bulk",
  "cf",
  "cu",
  "cuyd",
  "each",
  "ec",
  "for",
  "gal",
  "gallon",
  "gallons",
  "lb",
  "lbs",
  "low",
  "of",
  "pal",
  "pallet",
  "pallets",
  "sku",
  "store",
  "the",
  "yd",
  "yard",
  "yards",
]);

function normalizeMatchToken(token: string) {
  if (/^\d+(\.\d+)?$/.test(token)) return token;
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function matchTokens(...values: Array<string | null | undefined>) {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const rawToken of cleanString(value)
      ?.toLowerCase()
      .match(/[a-z0-9]+/g) ?? []) {
      const token = normalizeMatchToken(rawToken);
      if (token.length < 2 || ITEM_MATCH_STOP_WORDS.has(token)) continue;
      tokens.add(token);
    }
  }
  return tokens;
}

function tokenMatchScore(item: LocalItem, sourceTokens: Set<string>) {
  const tokenGroups = [
    matchTokens(item.name),
    matchTokens(item.xeroItemName),
    matchTokens(item.xeroPurchaseDescription),
  ].filter((tokens) => tokens.size > 0);
  if (tokenGroups.length === 0 || sourceTokens.size === 0) return 0;

  return Math.max(
    ...tokenGroups.map((itemTokens) => {
      let matched = 0;
      for (const token of itemTokens) {
        if (sourceTokens.has(token)) matched += 1;
      }

      const itemCoverage = matched / itemTokens.size;
      const sourceCoverage = matched / sourceTokens.size;
      return itemCoverage + sourceCoverage * 0.1;
    })
  );
}

function findBestFuzzyItemMatch(
  line: SourceLine,
  xeroItem: XeroItemSummary | undefined,
  localItems: LocalItem[]
) {
  const sourceTokens = matchTokens(
    line.itemCode,
    line.description,
    xeroItem?.code,
    xeroItem?.name,
    xeroItem?.purchaseDescription
  );
  let best: { item: LocalItem; score: number } | null = null;
  let secondBestScore = 0;

  for (const item of localItems) {
    const score = tokenMatchScore(item, sourceTokens);
    if (!best || score > best.score) {
      secondBestScore = best?.score ?? 0;
      best = { item, score };
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!best || best.score < 0.5) return null;
  if (best.score < 0.85 && best.score - secondBestScore < 0.2) return null;
  return best.item;
}

function productFingerprint(line: SourceLine, xeroItem: XeroItemSummary | undefined) {
  const tokens = matchTokens(
    xeroItem?.name,
    xeroItem?.purchaseDescription,
    line.description
  );
  if (tokens.size === 0) return normalizeKey(line.itemCode) ?? "missing-code";
  return [...tokens].sort().join(":");
}

function normalizePrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return normalizeNumeric(value);
}

function candidateCanBeApplied(params: {
  status: XeroPurchasingCandidateStatus;
  supplierId: string | null;
  supplierName: string | null;
  itemId: string | null;
  itemName: string | null;
  xeroItemCode: string | null;
  latestUnitCost: string | null;
}) {
  if (params.status === "excluded") return false;
  if (!params.latestUnitCost) return false;
  if (!params.supplierId && !cleanString(params.supplierName)) return false;
  if (!params.itemId && !cleanString(params.itemName) && !cleanString(params.xeroItemCode)) {
    return false;
  }
  return true;
}

function isDemoCompanyTenant(tenantName: string) {
  return tenantName.toLowerCase().startsWith("demo company");
}

function isExcludedLine(line: SourceLine) {
  const text = `${line.itemCode ?? ""} ${line.description ?? ""}`.toLowerCase();
  if (!line.itemCode) return "Missing Xero item code";
  if (line.unitAmount == null || !Number.isFinite(line.unitAmount)) {
    return "Missing unit price";
  }
  if (line.unitAmount <= 0) return "Non-positive unit price";
  if (/\b(ship|shipping|freight|delivery|transport|logistics)\b/.test(text)) {
    return "Freight or delivery";
  }
  if (/\b(tariff|discount|adjustment|fee|surcharge|import charge)\b/.test(text)) {
    return "Adjustment or fee";
  }
  return null;
}

function makeCandidateId(parts: {
  supplierId: string | null;
  itemId: string | null;
  xeroItemCode: string;
}) {
  return Buffer.from(
    JSON.stringify([parts.supplierId, parts.itemId, parts.xeroItemCode])
  ).toString("base64url");
}

function xeroItemSummary(item: {
  itemID?: string;
  code?: string;
  name?: string;
  purchaseDescription?: string;
  purchaseDetails?: {
    unitPrice?: number;
    accountCode?: string;
    taxType?: string;
  };
  updatedDateUTC?: Date | string;
}): XeroItemSummary {
  return {
    itemId: cleanString(item.itemID) ?? null,
    code: cleanString(item.code, 100) ?? null,
    name: cleanString(item.name) ?? null,
    purchaseDescription: cleanString(item.purchaseDescription, 1000) ?? null,
    purchaseUnitPrice:
      item.purchaseDetails?.unitPrice != null
        ? Number(item.purchaseDetails.unitPrice)
        : null,
    purchaseAccountCode: cleanString(item.purchaseDetails?.accountCode, 20) ?? null,
    purchaseTaxType: cleanString(item.purchaseDetails?.taxType, 50) ?? null,
    updatedAt: cleanDate(item.updatedDateUTC),
  };
}

async function fetchAllPurchaseOrders(authed: Awaited<ReturnType<typeof getAuthedXeroClient>>) {
  const purchaseOrders: unknown[] = [];
  for (let page = 1; page <= MAX_PURCHASE_ORDER_PAGES; page += 1) {
    const response = await authed.client.accountingApi.getPurchaseOrders(
      authed.tenantId,
      undefined,
      undefined,
      DEFAULT_SINCE_DATE,
      undefined,
      "Date DESC",
      page,
      PAGE_SIZE
    );
    const batch = response.body.purchaseOrders ?? [];
    purchaseOrders.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return purchaseOrders;
}

async function fetchAllBills(authed: Awaited<ReturnType<typeof getAuthedXeroClient>>) {
  const bills: unknown[] = [];
  for (let page = 1; page <= MAX_BILL_PAGES; page += 1) {
    const response = await authed.client.accountingApi.getInvoices(
      authed.tenantId,
      undefined,
      'Type=="ACCPAY"&&Date>=DateTime(2024,01,01)',
      "Date DESC",
      undefined,
      undefined,
      undefined,
      undefined,
      page,
      false,
      undefined,
      4,
      false,
      PAGE_SIZE
    );
    const batch = response.body.invoices ?? [];
    bills.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return bills;
}

function sourceLinesFromPurchaseOrder(order: Record<string, unknown>): SourceLine[] {
  const contact = (order.contact ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
  return lineItems.map((rawLine) => {
    const line = rawLine as Record<string, unknown>;
    return {
      sourceType: "purchase_order",
      sourceNumber: cleanString(order.purchaseOrderNumber as string | undefined, 80),
      sourceDate: asDateString(order.date as Date | string | undefined),
      supplierContactId: cleanString(contact.contactID as string | undefined),
      supplierName: cleanString(contact.name as string | undefined),
      itemCode: cleanString(line.itemCode as string | undefined, 100),
      description: cleanString(line.description as string | undefined, 1000),
      unitAmount:
        line.unitAmount != null && Number.isFinite(Number(line.unitAmount))
          ? Number(line.unitAmount)
          : null,
      accountCode: cleanString(line.accountCode as string | undefined, 20),
      taxType: cleanString(line.taxType as string | undefined, 50),
    };
  });
}

function sourceLinesFromBill(invoice: Record<string, unknown>): SourceLine[] {
  const contact = (invoice.contact ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  return lineItems.map((rawLine) => {
    const line = rawLine as Record<string, unknown>;
    return {
      sourceType: "bill",
      sourceNumber: cleanString(invoice.invoiceNumber as string | undefined, 80),
      sourceDate: asDateString(invoice.date as Date | string | undefined),
      supplierContactId: cleanString(contact.contactID as string | undefined),
      supplierName: cleanString(contact.name as string | undefined),
      itemCode: cleanString(line.itemCode as string | undefined, 100),
      description: cleanString(line.description as string | undefined, 1000),
      unitAmount:
        line.unitAmount != null && Number.isFinite(Number(line.unitAmount))
          ? Number(line.unitAmount)
          : null,
      accountCode: cleanString(line.accountCode as string | undefined, 20),
      taxType: cleanString(line.taxType as string | undefined, 50),
    };
  });
}

async function fetchXeroPurchasingData(orgId: string) {
  const authed = await getAuthedXeroClient(orgId);
  try {
    const [itemsResponse, purchaseOrders, bills] = await Promise.all([
      authed.client.accountingApi.getItems(authed.tenantId),
      fetchAllPurchaseOrders(authed),
      fetchAllBills(authed),
    ]);
    const xeroItems = (itemsResponse.body.items ?? [])
      .filter((item) => item.isPurchased === true)
      .map(xeroItemSummary);
    const xeroItemsByCode = new Map(
      xeroItems
        .filter((item) => item.code != null)
        .map((item) => [normalizeKey(item.code)!, item])
    );
    const sourceLines = [
      ...purchaseOrders.flatMap((order) =>
        sourceLinesFromPurchaseOrder(order as Record<string, unknown>)
      ),
      ...bills.flatMap((bill) => sourceLinesFromBill(bill as Record<string, unknown>)),
    ];

    return {
      tenantId: authed.tenantId,
      tenantName: authed.tenantName,
      xeroItems,
      xeroItemsByCode,
      sourceLines,
    };
  } catch (error) {
    console.error("Xero purchasing sync fetch failed:", redactXeroError(error));
    throw new XeroError(
      `Failed to fetch Xero purchasing data: ${extractXeroMessage(error)}`,
      502
    );
  }
}

async function loadLocalDataInTx(tx: Tx) {
  const localSuppliers = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
    })
    .from(suppliers)
    .where(isNull(suppliers.deletedAt));
  const localItems = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
        "defaultPurchasePrice"
      ),
    })
    .from(items)
    .where(isNull(items.deletedAt));
  const externalRecords = await tx
    .select({
      entityType: integrationExternalRecords.entityType,
      localRecordId: integrationExternalRecords.localRecordId,
      externalId: integrationExternalRecords.externalId,
      externalCode: integrationExternalRecords.externalCode,
      externalName: integrationExternalRecords.externalName,
      externalDescription: integrationExternalRecords.externalDescription,
    })
    .from(integrationExternalRecords)
    .where(eq(integrationExternalRecords.provider, ACCOUNTING_PROVIDER_XERO));
  const externalRecordByLocal = new Map(
    externalRecords.map((record) => [
      `${record.entityType}:${record.localRecordId}`,
      record,
    ])
  );
  const suppliersWithExternalData = localSuppliers.map((supplier) => {
    const external = externalRecordByLocal.get(`supplier:${supplier.id}`);
    return {
      ...supplier,
      xeroContactId: external?.externalId ?? null,
    };
  });
  const itemsWithExternalData = localItems.map((item) => {
    const external = externalRecordByLocal.get(`item:${item.id}`);
    return {
      ...item,
      xeroItemId: external?.externalId ?? null,
      xeroItemCode: external?.externalCode ?? null,
      xeroItemName: external?.externalName ?? null,
      xeroPurchaseDescription: external?.externalDescription ?? null,
    };
  });
  const existingSupplierItems = await tx
    .select({
      id: supplierItems.id,
      supplierId: supplierItems.supplierId,
      itemId: supplierItems.itemId,
      supplierSku: supplierItems.supplierSku,
      unitCost: trimScaleNullable(supplierItems.unitCost).as("unitCost"),
      isPreferred: supplierItems.isPreferred,
    })
    .from(supplierItems)
    .where(isNull(supplierItems.deletedAt));

  return {
    localSuppliers: suppliersWithExternalData,
    localItems: itemsWithExternalData,
    existingSupplierItems,
  };
}

function findSupplier(
  line: SourceLine,
  suppliersByXeroId: Map<string, LocalSupplier>,
  suppliersByName: Map<string, LocalSupplier>
) {
  const contactId = normalizeKey(line.supplierContactId);
  if (contactId) {
    const supplier = suppliersByXeroId.get(contactId);
    if (supplier) return supplier;
  }
  const name = normalizeKey(line.supplierName);
  return name ? suppliersByName.get(name) ?? null : null;
}

function findItem(
  line: SourceLine,
  xeroItem: XeroItemSummary | undefined,
  itemsBySku: Map<string, LocalItem>,
  itemsByXeroItemId: Map<string, LocalItem>,
  itemsByXeroCode: Map<string, LocalItem>,
  itemsByName: Map<string, LocalItem>,
  itemsByCompactName: Map<string, LocalItem>,
  localItems: LocalItem[]
) {
  const itemCode = normalizeKey(line.itemCode);
  if (xeroItem?.itemId) {
    const byXeroId = itemsByXeroItemId.get(xeroItem.itemId);
    if (byXeroId) return byXeroId;
  }
  if (itemCode) {
    const bySku = itemsBySku.get(itemCode);
    if (bySku) return bySku;
    const byXeroCode = itemsByXeroCode.get(itemCode);
    if (byXeroCode) return byXeroCode;
  }
  const xeroName = normalizeKey(xeroItem?.name) ?? normalizeKey(line.description);
  if (xeroName) {
    const byName = itemsByName.get(xeroName);
    if (byName) return byName;
  }
  const compactName =
    compactKey(xeroItem?.name) ?? compactKey(line.description);
  const exactCompactMatch = compactName ? itemsByCompactName.get(compactName) : null;
  if (exactCompactMatch) return exactCompactMatch;

  return findBestFuzzyItemMatch(line, xeroItem, localItems);
}

function buildCandidates(
  localData: Awaited<ReturnType<typeof loadLocalDataInTx>>,
  xeroData: Awaited<ReturnType<typeof fetchXeroPurchasingData>>
) {
  const suppliersByXeroId = new Map(
    localData.localSuppliers
      .filter((supplier) => supplier.xeroContactId)
      .map((supplier) => [normalizeKey(supplier.xeroContactId)!, supplier])
  );
  const suppliersByName = new Map(
    localData.localSuppliers.map((supplier) => [normalizeKey(supplier.name)!, supplier])
  );
  const itemsBySku = new Map(
    localData.localItems
      .filter((item) => item.sku)
      .map((item) => [normalizeKey(item.sku)!, item])
  );
  const itemsByXeroItemId = new Map(
    localData.localItems
      .filter((item) => item.xeroItemId)
      .map((item) => [item.xeroItemId!, item])
  );
  const itemsByXeroCode = new Map(
    localData.localItems
      .filter((item) => item.xeroItemCode)
      .map((item) => [normalizeKey(item.xeroItemCode)!, item])
  );
  const itemsByName = new Map(
    localData.localItems.map((item) => [normalizeKey(item.name)!, item])
  );
  const itemsByCompactName = new Map(
    localData.localItems.map((item) => [compactKey(item.name)!, item])
  );
  const supplierItemBySupplierItem = new Map(
    localData.existingSupplierItems.map((row) => [
      `${row.supplierId}:${row.itemId}`,
      row,
    ])
  );

  const grouped = new Map<
    string,
    {
      supplier: LocalSupplier | null;
      item: LocalItem | null;
      lines: SourceLine[];
      exclusionReason: string | null;
    }
  >();

  for (const line of xeroData.sourceLines) {
    const itemCode = cleanString(line.itemCode, 100);
    if (!itemCode) continue;
    const xeroItem = xeroData.xeroItemsByCode.get(normalizeKey(itemCode)!);
    const supplier = findSupplier(line, suppliersByXeroId, suppliersByName);
    const item = findItem(
      line,
      xeroItem,
      itemsBySku,
      itemsByXeroItemId,
      itemsByXeroCode,
      itemsByName,
      itemsByCompactName,
      localData.localItems
    );
    const exclusionReason = isExcludedLine(line);
    const itemGroupKey = item?.id ?? `missing-item:${productFingerprint(line, xeroItem)}`;
    const groupKey = `${supplier?.id ?? "missing-supplier"}:${itemGroupKey}`;
    const current =
      grouped.get(groupKey) ??
      {
        supplier,
        item,
        lines: [],
        exclusionReason,
      };
    current.lines.push(line);
    if (!current.exclusionReason && exclusionReason) {
      current.exclusionReason = exclusionReason;
    }
    grouped.set(groupKey, current);
  }

  const candidates = [...grouped.values()].map((group) => {
    const sortedLines = [...group.lines].sort((left, right) =>
      (right.sourceDate ?? "").localeCompare(left.sourceDate ?? "")
    );
    const latest = sortedLines[0];
    const latestItemCode = cleanString(latest?.itemCode, 100) ?? "";
    const latestXeroItem = latestItemCode
      ? xeroData.xeroItemsByCode.get(normalizeKey(latestItemCode)!)
      : undefined;
    const itemName =
      group.item?.name ??
      latestXeroItem?.name ??
      cleanString(latest?.description) ??
      latestItemCode;
    const supplierName =
      group.supplier?.name ?? latest?.supplierName ?? "Unmatched supplier";
    const productKey =
      latestXeroItem?.itemId ??
      productFingerprint(latest, latestXeroItem) ??
      normalizeKey(latestItemCode) ??
      latestItemCode;
    const latestUnitCost = normalizePrice(latest?.unitAmount);
    const status: XeroPurchasingCandidateStatus = group.exclusionReason
      ? "excluded"
      : !group.supplier
        ? "needs_supplier_match"
        : !group.item
          ? "needs_item_match"
          : "ready";
    const existingSupplierItem =
      group.supplier && group.item
        ? supplierItemBySupplierItem.get(`${group.supplier.id}:${group.item.id}`)
        : null;

    return {
      id: makeCandidateId({
        supplierId: group.supplier?.id ?? null,
        itemId: group.item?.id ?? null,
        xeroItemCode: latestItemCode,
      }),
      status,
      selectedByDefault: status === "ready",
      selectable: candidateCanBeApplied({
        status,
        supplierId: group.supplier?.id ?? null,
        supplierName,
        itemId: group.item?.id ?? null,
        itemName,
        xeroItemCode: latestItemCode,
        latestUnitCost,
      }),
      exclusionReason: group.exclusionReason,
      supplierId: group.supplier?.id ?? null,
      supplierName,
      xeroSupplierContactId: latest?.supplierContactId ?? null,
      itemId: group.item?.id ?? null,
      itemName: group.item?.name ?? null,
      itemSku: group.item?.sku ?? null,
      xeroItemId: latestXeroItem?.itemId ?? null,
      xeroItemCode: latestItemCode,
      xeroItemName: latestXeroItem?.name ?? null,
      xeroPurchaseDescription: latestXeroItem?.purchaseDescription ?? latest?.description ?? null,
      productKey,
      latestUnitCost,
      xeroItemUnitPrice: normalizePrice(latestXeroItem?.purchaseUnitPrice),
      existingSupplierItemUnitCost: existingSupplierItem?.unitCost ?? null,
      occurrences: group.lines.length,
      latestDate: latest?.sourceDate ?? null,
      latestSource: latest?.sourceNumber ?? null,
      accountingPurchaseAccountCode:
        latest?.accountCode ?? latestXeroItem?.purchaseAccountCode ?? null,
      xeroPurchaseTaxType: latest?.taxType ?? latestXeroItem?.purchaseTaxType ?? null,
    } satisfies XeroPurchasingCandidate;
  });

  return candidates.sort((left, right) => {
    const statusOrder = { ready: 0, needs_item_match: 1, needs_supplier_match: 2, excluded: 3 };
    const statusDiff = statusOrder[left.status] - statusOrder[right.status];
    if (statusDiff !== 0) return statusDiff;
    return right.occurrences - left.occurrences;
  });
}

export async function previewXeroPurchasingSync(
  orgId: string
): Promise<XeroPurchasingSyncPreview> {
  const xeroData = await fetchXeroPurchasingData(orgId);

  return withOrgContext(orgId, async (tx) => {
    const localData = await loadLocalDataInTx(tx);
    const candidates = buildCandidates(localData, xeroData);

    return {
      tenantName: xeroData.tenantName,
      sinceDate: DEFAULT_SINCE_DATE,
      totalXeroPurchasedItems: xeroData.xeroItems.length,
      totalSourceLines: xeroData.sourceLines.length,
      summary: {
        ready: candidates.filter((candidate) => candidate.status === "ready").length,
        selectedByDefault: candidates.filter((candidate) => candidate.selectedByDefault)
          .length,
        needsItemMatch: candidates.filter(
          (candidate) => candidate.status === "needs_item_match"
        ).length,
        needsSupplierMatch: candidates.filter(
          (candidate) => candidate.status === "needs_supplier_match"
        ).length,
        excluded: candidates.filter((candidate) => candidate.status === "excluded")
          .length,
      },
      candidates,
    };
  });
}

async function upsertSupplierItemInTx(
  tx: Tx,
  orgId: string,
  candidate: XeroPurchasingCandidate
) {
  if (!candidate.supplierId || !candidate.itemId || !candidate.latestUnitCost) {
    return { action: "skipped" as const, id: null };
  }

  const [existing] = await tx
    .select({ id: supplierItems.id })
    .from(supplierItems)
    .where(
      and(
        eq(supplierItems.supplierId, candidate.supplierId),
        eq(supplierItems.itemId, candidate.itemId),
        isNull(supplierItems.deletedAt)
      )
    );

  if (existing) {
    await tx
      .update(supplierItems)
      .set({
        supplierSku: candidate.xeroItemCode,
        unitCost: candidate.latestUnitCost,
        updatedAt: new Date(),
      })
      .where(eq(supplierItems.id, existing.id));
    return { action: "updated" as const, id: existing.id };
  }

  const [preferred] = await tx
    .select({ id: supplierItems.id })
    .from(supplierItems)
    .where(
      and(
        eq(supplierItems.itemId, candidate.itemId),
        eq(supplierItems.isPreferred, true),
        isNull(supplierItems.deletedAt)
      )
    )
    .limit(1);

  const [created] = await tx
    .insert(supplierItems)
    .values({
      organizationId: orgId,
      supplierId: candidate.supplierId,
      itemId: candidate.itemId,
      supplierSku: candidate.xeroItemCode,
      unitCost: candidate.latestUnitCost,
      isPreferred: preferred == null,
    })
    .returning({ id: supplierItems.id });

  return { action: "created" as const, id: created.id };
}

function supplierCreationKey(candidate: XeroPurchasingCandidate) {
  return (
    normalizeKey(candidate.xeroSupplierContactId) ??
    normalizeKey(candidate.supplierName) ??
    null
  );
}

function itemCreationKey(candidate: XeroPurchasingCandidate) {
  return (
    normalizeKey(candidate.xeroItemId) ??
    compactKey(candidate.productKey) ??
    normalizeKey(candidate.xeroItemCode) ??
    null
  );
}

async function getOrCreateDefaultImportedItemUnitInTx(tx: Tx, orgId: string) {
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
    .values({
      organizationId: orgId,
      name: "Each",
      size: "1",
      uom: "ea",
    })
    .returning({ id: unitDefinitions.id });

  return created.id;
}

async function createSupplierFromCandidateInTx(
  tx: Tx,
  orgId: string,
  candidate: XeroPurchasingCandidate
) {
  const name = cleanString(candidate.supplierName);
  if (!name || name === "Unmatched supplier") return null;

  const [created] = await tx
    .insert(suppliers)
    .values({
      organizationId: orgId,
      name,
    })
    .returning({ id: suppliers.id });

  if (candidate.xeroSupplierContactId) {
    await tx
      .insert(integrationExternalRecords)
      .values({
        organizationId: orgId,
        provider: ACCOUNTING_PROVIDER_XERO,
        entityType: "supplier",
        localRecordId: created.id,
        externalId: candidate.xeroSupplierContactId,
        externalName: name,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          integrationExternalRecords.organizationId,
          integrationExternalRecords.provider,
          integrationExternalRecords.entityType,
          integrationExternalRecords.localRecordId,
        ],
        set: {
          externalId: candidate.xeroSupplierContactId,
          externalName: name,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  return created.id;
}

async function createItemFromCandidateInTx(
  tx: Tx,
  orgId: string,
  candidate: XeroPurchasingCandidate
) {
  const unitDefinitionId = await getOrCreateDefaultImportedItemUnitInTx(tx, orgId);
  const name =
    cleanString(candidate.xeroItemName) ??
    cleanString(candidate.xeroPurchaseDescription) ??
    cleanString(candidate.xeroItemCode) ??
    "Imported Xero item";
  const defaultPurchasePrice = candidate.latestUnitCost ?? candidate.xeroItemUnitPrice;

  const [created] = await tx
    .insert(items)
    .values({
      organizationId: orgId,
      name,
      description: candidate.xeroPurchaseDescription,
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

  return created.id;
}

async function upsertItemExternalMetadataInTx(
  tx: Tx,
  orgId: string,
  itemId: string,
  candidate: XeroPurchasingCandidate,
  xeroItem: XeroItemSummary | undefined
) {
  await tx
    .insert(integrationExternalRecords)
    .values({
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      entityType: "item",
      localRecordId: itemId,
      externalId: xeroItem?.itemId ?? null,
      externalCode: candidate.xeroItemCode,
      externalName: candidate.xeroItemName,
      externalDescription: candidate.xeroPurchaseDescription,
      externalUpdatedAt: xeroItem?.updatedAt ?? null,
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        integrationExternalRecords.organizationId,
        integrationExternalRecords.provider,
        integrationExternalRecords.entityType,
        integrationExternalRecords.localRecordId,
      ],
      set: {
        externalId: xeroItem?.itemId ?? null,
        externalCode: candidate.xeroItemCode,
        externalName: candidate.xeroItemName,
        externalDescription: candidate.xeroPurchaseDescription,
        externalUpdatedAt: xeroItem?.updatedAt ?? null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  await tx
    .insert(accountingClassifications)
    .values({
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      entityType: "item",
      localRecordId: itemId,
      accountCode: candidate.accountingPurchaseAccountCode,
      taxType: candidate.xeroPurchaseTaxType,
    })
    .onConflictDoUpdate({
      target: [
        accountingClassifications.organizationId,
        accountingClassifications.provider,
        accountingClassifications.entityType,
        accountingClassifications.localRecordId,
      ],
      set: {
        accountCode: candidate.accountingPurchaseAccountCode,
        taxType: candidate.xeroPurchaseTaxType,
        updatedAt: new Date(),
      },
    });
}

export async function applyXeroPurchasingSync(
  orgId: string,
  candidateIds: string[],
  options?: { allowDemoCompany?: boolean }
): Promise<XeroPurchasingSyncApplyResult> {
  if (candidateIds.length === 0) {
    throw new XeroError("Select at least one purchasing row to import.", 400);
  }

  const selectedIds = new Set(candidateIds);
  const xeroData = await fetchXeroPurchasingData(orgId);
  if (
    process.env.NODE_ENV === "production" &&
    isDemoCompanyTenant(xeroData.tenantName) &&
    !options?.allowDemoCompany
  ) {
    throw new XeroError(
      "This is Xero Demo Company. Confirm the demo import explicitly before importing.",
      409
    );
  }

  return withOrgContext(orgId, async (tx) => {
    const localData = await loadLocalDataInTx(tx);
    const candidates = buildCandidates(localData, xeroData).filter((candidate) =>
      selectedIds.has(candidate.id)
    );
    const [run] = await tx
      .insert(integrationImportRuns)
      .values({
        organizationId: orgId,
        provider: ACCOUNTING_PROVIDER_XERO,
        entityType: "purchasing",
        tenantId: xeroData.tenantId,
        tenantName: xeroData.tenantName,
      })
      .returning({ id: integrationImportRuns.id });

    const result: XeroPurchasingSyncApplyResult = {
      runId: run.id,
      tenantName: xeroData.tenantName,
      created: 0,
      updated: 0,
      createdSuppliers: 0,
      createdItems: 0,
      skipped: 0,
      errors: [],
    };
    const createdSupplierIdsByKey = new Map<string, string>();
    const createdItemIdsByKey = new Map<string, string>();

    for (const candidate of candidates) {
      if (!candidate.selectable) {
        result.skipped += 1;
        continue;
      }

      try {
        const upsert = await tx.transaction(async (rowTx) => {
          const xeroItem = xeroData.xeroItemsByCode.get(
            normalizeKey(candidate.xeroItemCode)!
          );
          const supplierKey = supplierCreationKey(candidate);
          const cachedSupplierId = supplierKey
            ? createdSupplierIdsByKey.get(supplierKey)
            : null;
          const createdSupplierId =
            candidate.supplierId ??
            cachedSupplierId ??
            (await createSupplierFromCandidateInTx(rowTx, orgId, candidate));
          const itemKey = itemCreationKey(candidate);
          const cachedItemId = itemKey ? createdItemIdsByKey.get(itemKey) : null;
          const createdItemId =
            candidate.itemId ??
            cachedItemId ??
            (await createItemFromCandidateInTx(rowTx, orgId, candidate));

          if (!createdSupplierId || !createdItemId) {
            return {
              action: "skipped" as const,
              id: null,
              createdSupplierKey: null,
              createdSupplierId: null,
              createdItemKey: null,
              createdItemId: null,
            };
          }

          const resolvedCandidate = {
            ...candidate,
            supplierId: createdSupplierId,
            itemId: createdItemId,
          };
          await upsertItemExternalMetadataInTx(
            rowTx,
            orgId,
            createdItemId,
            resolvedCandidate,
            xeroItem
          );
          const rowUpsert = await upsertSupplierItemInTx(
            rowTx,
            orgId,
            resolvedCandidate
          );
          const createdSupplierKey =
            !candidate.supplierId && !cachedSupplierId && supplierKey
              ? supplierKey
              : null;
          const newSupplierId =
            !candidate.supplierId && !cachedSupplierId ? createdSupplierId : null;
          const createdItemKey =
            !candidate.itemId && !cachedItemId && itemKey ? itemKey : null;
          const newItemId = !candidate.itemId && !cachedItemId ? createdItemId : null;

          if (!rowUpsert.id) {
            return {
              ...rowUpsert,
              createdSupplierKey: null,
              createdSupplierId: null,
              createdItemKey: null,
              createdItemId: null,
            };
          }

          await rowTx.insert(integrationImportRunRows).values({
            organizationId: orgId,
            provider: ACCOUNTING_PROVIDER_XERO,
            runId: run.id,
            entityType: "purchasing",
            action: rowUpsert.action,
            localRecordId: rowUpsert.id,
            externalRecordId: candidate.xeroItemCode,
            localName: `${candidate.supplierName} - ${
              candidate.itemName ?? candidate.xeroItemCode
            }`,
            previousData: null,
          });

          return {
            ...rowUpsert,
            createdSupplierKey,
            createdSupplierId: newSupplierId,
            createdItemKey,
            createdItemId: newItemId,
          };
        });

        if (!upsert.id) {
          result.skipped += 1;
          continue;
        }
        if (upsert.createdSupplierKey && upsert.createdSupplierId) {
          createdSupplierIdsByKey.set(
            upsert.createdSupplierKey,
            upsert.createdSupplierId
          );
          result.createdSuppliers += 1;
        }
        if (upsert.createdItemKey && upsert.createdItemId) {
          createdItemIdsByKey.set(upsert.createdItemKey, upsert.createdItemId);
          result.createdItems += 1;
        }
        if (upsert.action === "created") result.created += 1;
        else result.updated += 1;
      } catch (error) {
        console.error("Xero purchasing sync row failed:", redactXeroError(error));
        result.errors.push(
          `${candidate.supplierName} / ${
            candidate.xeroItemCode
          }: ${formatPurchasingSyncRowError(error)}`
        );
      }
    }

    result.skipped += selectedIds.size - candidates.length;

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

function formatPurchasingSyncRowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    message.includes("Failed query:") ||
    message.includes("violates unique constraint") ||
    message.includes("duplicate key value")
  ) {
    return "Could not save this row. The details were logged for support.";
  }

  return extractXeroMessage(error);
}
