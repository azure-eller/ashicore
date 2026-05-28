import "server-only";

import {
  normalizeAddressFields,
  normalizeNumeric,
  summarizeItems,
} from "@/lib/format";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  items,
  itemFamilies,
  accountingClassifications,
  accountingAttachmentSyncs,
  accountingDocumentSyncs,
  attachmentFiles,
  integrationExternalRecords,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
  ACCOUNTING_DOCUMENT_PURCHASE_BILL,
  ACCOUNTING_PROVIDER_XERO,
  ATTACHMENT_OWNER_PURCHASE_ORDER,
  persistAccountingDocumentPushSuccess,
} from "@/lib/accounting/sync-state";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  getTaxRatesByIdInTx,
  getTaxSettingsInTx,
} from "@/lib/dal/tax-settings";
import type { Tx } from "@/lib/db/with-org-context";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import {
  calculatePurchaseOrderLandedCosts,
  normalizeLandedMoney,
  normalizeLandedQuantity,
  normalizeLandedStockUnitCost,
} from "@/lib/purchasing/landed-cost";
import {
  calculateTaxAmount,
  calculateTaxedLineTotal,
} from "@/lib/tax/calc";
import {
  addExpectedFromPurchaseInTx,
  beginInventoryOperationInTx,
  deriveInventoryIdempotencyKey,
  editExpectedFromPurchaseInTx,
  finishInventoryOperationInTx,
  receivePurchaseStockInTx,
  releaseExpectedFromPurchaseInTx,
} from "@/lib/inventory/kernel";
import { DomainError, type DomainFieldErrors } from "@/lib/errors/domain-error";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type {
  InsertPurchaseOrder,
  CreatePurchaseBill,
  PurchaseOrderStatus,
  ReceivePurchaseOrder,
  UpdatePurchaseOrder,
} from "@/lib/schemas/purchase-orders";
import type { InsertSupplier, UpdateSupplier } from "@/lib/schemas/suppliers";
import type {
  PurchaseOrderDetail,
  PurchaseOrderDetailLine,
  PurchaseOrderAttachment,
  PurchaseOrderEditData,
  PurchaseOrderListRow,
  PurchaseOrderMaterialOption,
  SupplierRow,
} from "./types";
import { alias } from "drizzle-orm/pg-core";

const purchaseOrderSyncs = alias(accountingDocumentSyncs, "purchase_order_syncs");
const purchaseBillSyncs = alias(accountingDocumentSyncs, "purchase_bill_syncs");

type PreparedPurchaseOrderLine = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  purchaseUnitName: string;
  stockingUnitName: string;
  purchaseToStockFactor: string;
  quantityOrdered: string;
  quantityReceived: string;
  stockQuantityOrdered: string;
  stockQuantityReceived: string;
  unitCost: string;
  stockUnitCost: string;
  taxRateId: string | null;
  taxRateName: string | null;
  taxRatePercent: string;
  accountingPurchaseAccountCode: string | null;
  shipAddressEntryId: string | null;
  shipContactName: string | null;
  shipContactPhone: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  shipDeliveryInstructions: string | null;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  sortOrder: number;
};

type PreparedPurchaseOrderAdditionalCost = {
  organizationId: string;
  costType: "shipping" | "customs" | "other";
  reference: string | null;
  distributionMethod: "by_value" | "not_distributed";
  accountingPurchaseAccountCode: string | null;
  amount: string;
  sortOrder: number;
};

type MaterialValidationRow = {
  id: string;
  name: string;
  sku: string | null;
  stockingUnitName: string;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  defaultPurchasePrice: string | null;
  currentStockUnitCost: string | null;
  accountingPurchaseAccountCode: string | null;
};

export type PurchaseOrderLineInput = Omit<
  InsertPurchaseOrder["lines"][number],
  | "accountingPurchaseAccountCode"
  | "shipAddressEntryId"
  | "shipContactName"
  | "shipContactPhone"
  | "shipLine1"
  | "shipLine2"
  | "shipCity"
  | "shipRegion"
  | "shipPostcode"
  | "shipCountry"
  | "shipDeliveryInstructions"
> & {
  accountingPurchaseAccountCode?: string | null;
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
  purchaseUnitDefinitionId?: string | null;
  purchaseToStockFactor?: string | null;
};

export type PurchaseOrderAdditionalCostInput = Omit<
  InsertPurchaseOrder["additionalCosts"][number],
  "accountingPurchaseAccountCode"
> & {
  accountingPurchaseAccountCode?: string | null;
};

export type PurchaseOrderPayload = Omit<
  InsertPurchaseOrder,
  | "lines"
  | "shippingCost"
  | "additionalCosts"
  | "accountingPurchaseAccountCode"
  | "shipLine1"
  | "shipLine2"
  | "shipCity"
  | "shipRegion"
  | "shipPostcode"
  | "shipCountry"
> & {
  shippingCost?: string | null;
  accountingPurchaseAccountCode?: string | null;
  shipLine1?: string | null;
  shipLine2?: string | null;
  shipCity?: string | null;
  shipRegion?: string | null;
  shipPostcode?: string | null;
  shipCountry?: string | null;
  lines: PurchaseOrderLineInput[];
  additionalCosts?: PurchaseOrderAdditionalCostInput[];
};

export type CreatePurchaseOrderDraftOptions = {
  orderNumber?: string;
  externalPurchaseOrderId?: string | null;
  externalPurchaseOrderNumber?: string | null;
  accountingPushStatus?: "pushed" | "pending" | "failed" | null;
  accountingProvider?: string;
};

export type ImportedAccountingPurchaseOrder = PurchaseOrderPayload & {
  accountingProvider: string;
  orderNumber: string;
  externalPurchaseOrderId: string;
  externalPurchaseOrderNumber: string;
  orderedAt?: Date | null;
};

export class PurchasingError extends DomainError<{
  overReceipt: {
    lines: Array<{
      lineId: string;
      itemName: string;
      remaining: string;
      requested: string;
      overage: string;
    }>;
  };
}> {
  errors?: Record<string, string[]>;
  overReceipt?: {
    lines: Array<{
      lineId: string;
      itemName: string;
      remaining: string;
      requested: string;
      overage: string;
    }>;
  };

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      overReceipt?: {
        lines: Array<{
          lineId: string;
          itemName: string;
          remaining: string;
          requested: string;
          overage: string;
        }>;
      };
    },
  ) {
    const errors: DomainFieldErrors | undefined = options?.errors;

    super(message, status, {
      name: "PurchasingError",
      errors,
      extra: options?.overReceipt
        ? { overReceipt: options.overReceipt }
        : undefined,
    });

    this.errors = options?.errors;
    this.overReceipt = options?.overReceipt;
  }
}

async function getLockedPurchaseOrderInTx(tx: Tx, id: string) {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

async function generateOrderNumber(tx: Tx) {
  const result = await tx.execute(
    sql`SELECT nextval('purchasing.order_number_seq') AS val`,
  );
  const raw = (result.rows[0] as { val: string | number }).val;
  const sequenceValue = Number(raw);
  const year = new Date().getFullYear();
  return `PO-${year}-${String(sequenceValue).padStart(4, "0")}`;
}

async function getValidatedSupplierInTx(tx: Tx, supplierId: string) {
  const [supplier] = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
    })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)));

  if (!supplier) {
    throw new PurchasingError("Supplier not found", 404, {
      errors: {
        supplierId: ["Select an active supplier"],
      },
    });
  }

  return supplier;
}

async function getActivePurchaseOrderInTx(tx: Tx, id: string) {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      organizationId: purchaseOrders.organizationId,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)));

  return order ?? null;
}

function mapPurchaseOrderAttachment(row: {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: Date;
  syncStatus: string | null;
  syncError: string | null;
  syncedAt: Date | null;
}): PurchaseOrderAttachment {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedByName: row.uploadedByName,
    createdAt: row.createdAt,
    syncStatus:
      row.syncStatus === "synced" || row.syncStatus === "failed"
        ? row.syncStatus
        : null,
    syncError: row.syncError,
    syncedAt: row.syncedAt,
  };
}

async function getPurchaseOrderAttachmentsInTx(
  tx: Tx,
  id: string,
): Promise<PurchaseOrderAttachment[]> {
  const rows = await tx
    .select({
      id: attachmentFiles.id,
      filename: attachmentFiles.filename,
      contentType: attachmentFiles.contentType,
      sizeBytes: attachmentFiles.sizeBytes,
      uploadedByName: attachmentFiles.uploadedByName,
      createdAt: attachmentFiles.createdAt,
      syncStatus: accountingAttachmentSyncs.syncStatus,
      syncError: accountingAttachmentSyncs.syncError,
      syncedAt: accountingAttachmentSyncs.syncedAt,
    })
    .from(attachmentFiles)
    .leftJoin(
      accountingAttachmentSyncs,
      and(
        eq(accountingAttachmentSyncs.attachmentId, attachmentFiles.id),
        eq(accountingAttachmentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
      ),
    )
    .where(
      and(
        eq(attachmentFiles.ownerType, ATTACHMENT_OWNER_PURCHASE_ORDER),
        eq(attachmentFiles.ownerId, id),
        isNull(attachmentFiles.deletedAt),
      ),
    )
    .orderBy(desc(attachmentFiles.createdAt), desc(attachmentFiles.id));

  return rows.map(mapPurchaseOrderAttachment);
}

async function getValidatedMaterialsInTx(tx: Tx, itemIds: string[]) {
  const uniqueIds = [...new Set(itemIds)];

  const rows = await tx
    .select({
      id: items.id,
      name: sql<string>`COALESCE(${itemFamilies.name}, ${items.name})`,
      sku: items.sku,
      stockingUnitName: unitDefinitions.name,
      purchaseUnitName: sql<string | null>`(
        SELECT ${unitDefinitions.name}
        FROM ${unitDefinitions}
        WHERE ${unitDefinitions.id} = COALESCE(${itemFamilies.purchaseUnitDefinitionId}, ${items.purchaseUnitDefinitionId})
      )`,
      purchaseToStockFactor: trimScaleNullable(
        sql`COALESCE(${itemFamilies.purchaseToStockFactor}, ${items.purchaseToStockFactor})`,
      ).as("purchaseToStockFactor"),
      defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
        "defaultPurchasePrice",
      ),
      currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
        "currentStockUnitCost",
      ),
      accountingPurchaseAccountCode: sql<string | null>`(
        SELECT ${accountingClassifications.accountCode}
        FROM ${accountingClassifications}
        WHERE ${accountingClassifications.provider} = ${ACCOUNTING_PROVIDER_XERO}
          AND ${accountingClassifications.entityType} = 'item'
          AND ${accountingClassifications.localRecordId} = ${items.id}
        LIMIT 1
      )`,
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        inArray(items.id, uniqueIds),
        eq(items.itemType, "material"),
        isNull(items.deletedAt),
      ),
    );

  const itemMap = new Map(
    rows.map((row) => [row.id, row as MaterialValidationRow]),
  );

  if (itemMap.size !== uniqueIds.length) {
    throw new PurchasingError("Material not found", 404);
  }

  return itemMap;
}

async function getPurchaseOrderLinesInTx(tx: Tx, purchaseOrderId: string) {
  return tx
    .select({
      id: purchaseOrderLines.id,
      itemId: purchaseOrderLines.itemId,
      itemName: purchaseOrderLines.itemName,
      itemSku: purchaseOrderLines.itemSku,
      lotTrackingMode: sql<"tracked" | "untracked">`COALESCE(${itemFamilies.lotTrackingMode}, 'tracked')`,
      purchaseUnitName: purchaseOrderLines.purchaseUnitName,
      stockingUnitName: purchaseOrderLines.stockingUnitName,
      purchaseToStockFactor: trimScale(
        purchaseOrderLines.purchaseToStockFactor,
      ).as("purchaseToStockFactor"),
      quantityOrdered: trimScale(purchaseOrderLines.quantityOrdered).as(
        "quantityOrdered",
      ),
      quantityReceived: trimScale(purchaseOrderLines.quantityReceived).as(
        "quantityReceived",
      ),
      stockQuantityOrdered: trimScale(
        purchaseOrderLines.stockQuantityOrdered,
      ).as("stockQuantityOrdered"),
      stockQuantityReceived: trimScale(
        purchaseOrderLines.stockQuantityReceived,
      ).as("stockQuantityReceived"),
      unitCost: trimScale(purchaseOrderLines.unitCost).as("unitCost"),
      stockUnitCost: trimScale(purchaseOrderLines.stockUnitCost).as(
        "stockUnitCost",
      ),
      taxRateId: purchaseOrderLines.taxRateId,
      taxRateName: purchaseOrderLines.taxRateName,
      taxRatePercent: trimScale(purchaseOrderLines.taxRatePercent).as(
        "taxRatePercent",
      ),
      accountingPurchaseAccountCode:
        purchaseOrderLines.accountingPurchaseAccountCode,
      shipAddressEntryId: purchaseOrderLines.shipAddressEntryId,
      shipContactName: purchaseOrderLines.shipContactName,
      shipContactPhone: purchaseOrderLines.shipContactPhone,
      shipLine1: purchaseOrderLines.shipLine1,
      shipLine2: purchaseOrderLines.shipLine2,
      shipCity: purchaseOrderLines.shipCity,
      shipRegion: purchaseOrderLines.shipRegion,
      shipPostcode: purchaseOrderLines.shipPostcode,
      shipCountry: purchaseOrderLines.shipCountry,
      shipDeliveryInstructions: purchaseOrderLines.shipDeliveryInstructions,
      lineSubtotal: trimScale(purchaseOrderLines.lineSubtotal).as(
        "lineSubtotal",
      ),
      lineTaxAmount: trimScale(purchaseOrderLines.lineTaxAmount).as(
        "lineTaxAmount",
      ),
      lineTotal: trimScale(purchaseOrderLines.lineTotal).as("lineTotal"),
      sortOrder: purchaseOrderLines.sortOrder,
      createdAt: purchaseOrderLines.createdAt,
      updatedAt: purchaseOrderLines.updatedAt,
    })
    .from(purchaseOrderLines)
    .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .leftJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
    .orderBy(
      asc(purchaseOrderLines.sortOrder),
      asc(purchaseOrderLines.createdAt),
    );
}

async function getPurchaseOrderAdditionalCostsInTx(
  tx: Tx,
  purchaseOrderId: string,
) {
  return tx
    .select({
      id: purchaseOrderAdditionalCosts.id,
      costType: purchaseOrderAdditionalCosts.costType,
      reference: purchaseOrderAdditionalCosts.reference,
      distributionMethod: purchaseOrderAdditionalCosts.distributionMethod,
      accountingPurchaseAccountCode:
        purchaseOrderAdditionalCosts.accountingPurchaseAccountCode,
      amount: trimScale(purchaseOrderAdditionalCosts.amount).as("amount"),
      sortOrder: purchaseOrderAdditionalCosts.sortOrder,
      createdAt: purchaseOrderAdditionalCosts.createdAt,
      updatedAt: purchaseOrderAdditionalCosts.updatedAt,
    })
    .from(purchaseOrderAdditionalCosts)
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, purchaseOrderId))
    .orderBy(
      asc(purchaseOrderAdditionalCosts.sortOrder),
      asc(purchaseOrderAdditionalCosts.createdAt),
    );
}

function normalizeAdditionalCostInputs(
  payload: PurchaseOrderPayload | UpdatePurchaseOrder,
) {
  const rows = [...(payload.additionalCosts ?? [])];
  const legacyShippingCost = Number(payload.shippingCost ?? "0");
  if (
    rows.length === 0 &&
    Number.isFinite(legacyShippingCost) &&
    legacyShippingCost > 0
  ) {
    rows.push({
      costType: "shipping",
      reference: null,
      distributionMethod: "by_value",
      accountingPurchaseAccountCode: null,
      amount: normalizeNumeric(legacyShippingCost),
    });
  }
  return rows;
}

async function preparePurchaseOrderPayload(
  tx: Tx,
  orgId: string,
  payload: PurchaseOrderPayload | UpdatePurchaseOrder,
): Promise<{
  supplierId: string;
  supplierName: string;
  expectedDate: string | null;
  notes: string | null;
  accountingPurchaseAccountCode: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  shippingCost: string;
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  preparedLines: PreparedPurchaseOrderLine[];
  preparedAdditionalCosts: PreparedPurchaseOrderAdditionalCost[];
  affectedItemIds: string[];
}> {
  const supplier = await getValidatedSupplierInTx(tx, payload.supplierId);
  const materials = await getValidatedMaterialsInTx(
    tx,
    payload.lines.map((line) => line.itemId),
  );
  const taxSettings = await getTaxSettingsInTx(tx, orgId);
  const defaultPurchaseTaxRateId = taxSettings.defaultPurchaseTaxRateId;
  const taxRatesById = await getTaxRatesByIdInTx(
    tx,
    [
      ...payload.lines
        .map((line) => line.taxRateId?.trim() ?? "")
        .filter(Boolean),
      ...(defaultPurchaseTaxRateId ? [defaultPurchaseTaxRateId] : []),
    ],
  );
  const purchaseUnitIds = [
    ...new Set(
      payload.lines
        .map((line) =>
          "purchaseUnitDefinitionId" in line
            ? line.purchaseUnitDefinitionId
            : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const purchaseUnitRows =
    purchaseUnitIds.length === 0
      ? []
      : await tx
          .select({ id: unitDefinitions.id, name: unitDefinitions.name })
          .from(unitDefinitions)
          .where(inArray(unitDefinitions.id, purchaseUnitIds));
  const purchaseUnitNameById = new Map(
    purchaseUnitRows.map((unit) => [unit.id, unit.name]),
  );

  const additionalCostInputs = normalizeAdditionalCostInputs(payload);
  const preparedAdditionalCosts = additionalCostInputs.map((cost, index) => ({
    organizationId: orgId,
    costType: cost.costType,
    reference: cost.reference?.trim() || null,
    distributionMethod: cost.distributionMethod,
    accountingPurchaseAccountCode:
      cost.accountingPurchaseAccountCode?.trim() || null,
    amount: normalizeNumeric(Number(cost.amount)),
    sortOrder: index,
  }));
  const shippingCost = preparedAdditionalCosts
    .filter((cost) => cost.costType === "shipping")
    .reduce((sum, cost) => sum + Number(cost.amount), 0);
  const landedCosts = calculatePurchaseOrderLandedCosts({
    lines: payload.lines.map((line) => {
      const material = materials.get(line.itemId);
      const overrideFactor =
        "purchaseToStockFactor" in line ? line.purchaseToStockFactor : null;

      return {
        quantityOrdered: line.quantityOrdered,
        unitCost: line.unitCost,
        purchaseToStockFactor:
          overrideFactor ?? material?.purchaseToStockFactor ?? "1",
      };
    }),
    additionalCosts: preparedAdditionalCosts,
  });

  const preparedLines = payload.lines.map((line, index) => {
    const material = materials.get(line.itemId);

    if (!material) {
      throw new PurchasingError("Material not found", 404);
    }

    const quantityOrdered = Number(line.quantityOrdered);
    const unitCost = Number(line.unitCost);
    const lineCosts = landedCosts.lines[index];
    const overrideFactor =
      "purchaseToStockFactor" in line ? line.purchaseToStockFactor : null;
    const overrideUnitId =
      "purchaseUnitDefinitionId" in line ? line.purchaseUnitDefinitionId : null;
    const purchaseToStockFactor = Number(
      overrideFactor ?? material.purchaseToStockFactor ?? "1",
    );
    const stockQuantityOrdered = lineCosts.stockQuantityOrdered;
    const stockUnitCost = normalizeLandedStockUnitCost(
      lineCosts.landedStockUnitCost,
    );
    const lineAddress = normalizeAddressFields({
      line1: line.shipLine1,
      line2: line.shipLine2,
      city: line.shipCity,
      region: line.shipRegion,
      postcode: line.shipPostcode,
      country: line.shipCountry,
    });

    if (stockUnitCost == null) {
      throw new PurchasingError("Unable to calculate landed unit cost.", 400);
    }

    const effectiveTaxRateId =
      line.taxRateId === undefined ? defaultPurchaseTaxRateId : line.taxRateId;
    const selectedTaxRate = effectiveTaxRateId
      ? taxRatesById.get(effectiveTaxRateId) ?? null
      : null;
    const lineSubtotal = lineCosts.lineSubtotal;
    const lineTaxAmount = calculateTaxAmount(
      lineSubtotal,
      selectedTaxRate?.ratePercent ?? 0,
      4,
    );
    const lineTotal = calculateTaxedLineTotal(lineSubtotal, lineTaxAmount, 4);

    return {
      itemId: material.id,
      itemName: material.name,
      itemSku: material.sku,
      purchaseUnitName:
        (overrideUnitId ? purchaseUnitNameById.get(overrideUnitId) : null) ??
        material.purchaseUnitName ??
        material.stockingUnitName,
      stockingUnitName: material.stockingUnitName,
      purchaseToStockFactor: normalizeNumeric(purchaseToStockFactor),
      quantityOrdered: normalizeNumeric(quantityOrdered),
      quantityReceived: "0",
      stockQuantityOrdered: normalizeLandedQuantity(stockQuantityOrdered),
      stockQuantityReceived: "0",
      unitCost: normalizeNumeric(unitCost),
      stockUnitCost,
      taxRateId: selectedTaxRate?.id ?? null,
      taxRateName: selectedTaxRate?.name ?? null,
      taxRatePercent: selectedTaxRate?.ratePercent ?? "0",
      accountingPurchaseAccountCode:
        line.accountingPurchaseAccountCode?.trim() ||
        material.accountingPurchaseAccountCode ||
        null,
      shipAddressEntryId: line.shipAddressEntryId?.trim() || null,
      shipContactName: line.shipContactName?.trim() || null,
      shipContactPhone: line.shipContactPhone?.trim() || null,
      shipLine1: lineAddress.line1,
      shipLine2: lineAddress.line2,
      shipCity: lineAddress.city,
      shipRegion: lineAddress.region,
      shipPostcode: lineAddress.postcode,
      shipCountry: lineAddress.country,
      shipDeliveryInstructions: line.shipDeliveryInstructions?.trim() || null,
      lineSubtotal: normalizeLandedMoney(lineSubtotal),
      lineTaxAmount,
      lineTotal,
      sortOrder: index,
    };
  });
  const lineTaxTotal = preparedLines.reduce(
    (sum, line) => sum + Number(line.lineTaxAmount),
    0,
  );
  const subtotalAmount = landedCosts.orderTotal;
  const taxAmount = lineTaxTotal;
  const totalAmount = subtotalAmount + taxAmount;
  const address = normalizeAddressFields({
    line1: payload.shipLine1,
    line2: payload.shipLine2,
    city: payload.shipCity,
    region: payload.shipRegion,
    postcode: payload.shipPostcode,
    country: payload.shipCountry,
  });

  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    expectedDate: payload.expectedDate,
    notes: payload.notes,
    accountingPurchaseAccountCode:
      payload.accountingPurchaseAccountCode?.trim() || null,
    shipLine1: address.line1,
    shipLine2: address.line2,
    shipCity: address.city,
    shipRegion: address.region,
    shipPostcode: address.postcode,
    shipCountry: address.country,
    shippingCost: normalizeNumeric(shippingCost),
    subtotalAmount: normalizeLandedMoney(subtotalAmount),
    taxAmount: normalizeLandedMoney(taxAmount),
    totalAmount: normalizeLandedMoney(totalAmount),
    preparedLines,
    preparedAdditionalCosts,
    affectedItemIds: preparedLines.map((line) => line.itemId),
  };
}

async function ensureSuppliersDeletableInTx(tx: Tx, supplierIds: string[]) {
  const uniqueSupplierIds = [...new Set(supplierIds)];

  const [blockingOrder] = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        inArray(purchaseOrders.supplierId, uniqueSupplierIds),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrders.status, ["draft", "ordered", "partial"]),
      ),
    )
    .limit(1);

  if (blockingOrder) {
    throw new PurchasingError(
      "Cannot delete supplier with active draft, ordered, or partially received purchase orders.",
      400,
    );
  }

  return uniqueSupplierIds;
}

async function softDeleteSuppliersInTx(tx: Tx, supplierIds: string[]) {
  if (supplierIds.length === 0) {
    return [];
  }

  return tx
    .update(suppliers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(inArray(suppliers.id, supplierIds), isNull(suppliers.deletedAt)))
    .returning({ id: suppliers.id });
}

const supplierRowSelect = {
  id: suppliers.id,
  name: suppliers.name,
  code: suppliers.code,
  contactName: suppliers.contactName,
  email: suppliers.email,
  phone: suppliers.phone,
  billingLine1: suppliers.billingLine1,
  billingLine2: suppliers.billingLine2,
  billingCity: suppliers.billingCity,
  billingRegion: suppliers.billingRegion,
  billingPostcode: suppliers.billingPostcode,
  billingCountry: suppliers.billingCountry,
  xeroContactId: sql<string | null>`(
    SELECT ${integrationExternalRecords.externalId}
    FROM ${integrationExternalRecords}
    WHERE ${integrationExternalRecords.provider} = ${ACCOUNTING_PROVIDER_XERO}
      AND ${integrationExternalRecords.entityType} = 'supplier'
      AND ${integrationExternalRecords.localRecordId} = ${suppliers.id}
    LIMIT 1
  )`,
  paymentTerms: suppliers.paymentTerms,
  notes: suppliers.notes,
  deletedAt: suppliers.deletedAt,
  createdAt: suppliers.createdAt,
  updatedAt: suppliers.updatedAt,
} as const;

export async function getSuppliers(): Promise<SupplierRow[]> {
  return measureObservedOperation(
    "purchasing.get_suppliers",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        return tx
          .select(supplierRowSelect)
          .from(suppliers)
          .where(isNull(suppliers.deletedAt))
          .orderBy(asc(suppliers.name));
      });
    },
    {
      successData: (rows) => ({
        rowCount: rows.length,
      }),
    }
  );
}

export async function getSupplier(
  id: string,
  options?: { includeDeleted?: boolean },
): Promise<SupplierRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [eq(suppliers.id, id)];

    if (!options?.includeDeleted) {
      conditions.push(isNull(suppliers.deletedAt));
    }

    const [supplier] = await tx
      .select(supplierRowSelect)
      .from(suppliers)
      .where(and(...conditions));

    return supplier ?? null;
  });
}

export async function createSupplier(data: InsertSupplier) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [supplier] = await tx
      .insert(suppliers)
      .values({
        organizationId: orgId,
        ...data,
      })
      .returning({ id: suppliers.id, name: suppliers.name });

    return supplier;
  });
}

export async function updateSupplier(id: string, data: UpdateSupplier) {
  return withAuthedOrgContext(async (tx) => {
    const [supplier] = await tx
      .update(suppliers)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .returning({ id: suppliers.id });

    return supplier ?? null;
  });
}

export async function deleteSupplier(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const supplierIds = await ensureSuppliersDeletableInTx(tx, [id]);
    const [supplier] = await softDeleteSuppliersInTx(tx, supplierIds);
    return { deleted: supplier != null };
  });
}

export async function deleteSuppliers(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const supplierIds = await ensureSuppliersDeletableInTx(tx, ids);
    const deletedSuppliers = await softDeleteSuppliersInTx(tx, supplierIds);
    return { deletedCount: deletedSuppliers.length };
  });
}

export async function getPurchaseOrderMaterialOptions(): Promise<
  PurchaseOrderMaterialOption[]
> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: items.id,
        name: sql<string>`COALESCE(${itemFamilies.name}, ${items.name})`,
        sku: items.sku,
        stockingUnitName: unitDefinitions.name,
        purchaseUnitName: sql<string | null>`(
          SELECT ${unitDefinitions.name}
          FROM ${unitDefinitions}
          WHERE ${unitDefinitions.id} = COALESCE(${itemFamilies.purchaseUnitDefinitionId}, ${items.purchaseUnitDefinitionId})
        )`,
        purchaseToStockFactor: trimScaleNullable(
          sql`COALESCE(${itemFamilies.purchaseToStockFactor}, ${items.purchaseToStockFactor})`,
        ).as("purchaseToStockFactor"),
        defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
          "defaultPurchasePrice",
        ),
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost",
        ),
        accountingPurchaseAccountCode: sql<string | null>`(
          SELECT ${accountingClassifications.accountCode}
          FROM ${accountingClassifications}
          WHERE ${accountingClassifications.provider} = ${ACCOUNTING_PROVIDER_XERO}
            AND ${accountingClassifications.entityType} = 'item'
            AND ${accountingClassifications.localRecordId} = ${items.id}
          LIMIT 1
        )`,
      })
      .from(items)
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .innerJoin(
        unitDefinitions,
        eq(items.unitDefinitionId, unitDefinitions.id),
      )
      .where(and(eq(items.itemType, "material"), isNull(items.deletedAt)))
      .orderBy(asc(items.name));
  });
}

export async function getPurchaseOrders(): Promise<PurchaseOrderListRow[]> {
  return measureObservedOperation(
    "purchasing.get_orders",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const orderRows = await tx
          .select({
            id: purchaseOrders.id,
            orderNumber: purchaseOrders.orderNumber,
            supplierName: purchaseOrders.supplierName,
            status: purchaseOrders.status,
            expectedDate: purchaseOrders.expectedDate,
            shippingCost: trimScale(purchaseOrders.shippingCost).as(
              "shippingCost",
            ),
            totalAmount: trimScale(purchaseOrders.totalAmount).as(
              "totalAmount",
            ),
            deletedAt: purchaseOrders.deletedAt,
            createdAt: purchaseOrders.createdAt,
            updatedAt: purchaseOrders.updatedAt,
            receivedAt: purchaseOrders.receivedAt,
            purchaseBillStatus: purchaseBillSyncs.pushStatus,
            purchaseBillError: purchaseBillSyncs.pushError,
            purchaseBillExternalId: purchaseBillSyncs.externalDocumentId,
            purchaseBillExternalNumber: purchaseBillSyncs.externalDocumentNumber,
            purchaseBillPushedAt: purchaseBillSyncs.pushedAt,
          })
          .from(purchaseOrders)
          .leftJoin(
            purchaseBillSyncs,
            and(
              eq(purchaseBillSyncs.provider, ACCOUNTING_PROVIDER_XERO),
              eq(purchaseBillSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
              eq(purchaseBillSyncs.documentId, purchaseOrders.id),
            ),
          )
          .where(isNull(purchaseOrders.deletedAt))
          .orderBy(
            desc(purchaseOrders.createdAt),
            asc(purchaseOrders.orderNumber),
            asc(purchaseOrders.id),
          );

        if (orderRows.length === 0) {
          return [];
        }

        const orderIds = orderRows.map((order) => order.id);
        const lines = await tx
          .select({
            purchaseOrderId: purchaseOrderLines.purchaseOrderId,
            itemName: purchaseOrderLines.itemName,
            quantity: trimScale(purchaseOrderLines.quantityOrdered).as(
              "quantity",
            ),
            sortOrder: purchaseOrderLines.sortOrder,
          })
          .from(purchaseOrderLines)
          .where(inArray(purchaseOrderLines.purchaseOrderId, orderIds))
          .orderBy(
            asc(purchaseOrderLines.sortOrder),
            asc(purchaseOrderLines.createdAt),
          );

        const linesByOrderId = new Map<
          string,
          Array<{ itemName: string; quantity: string }>
        >();
        lines.forEach((line) => {
          const bucket = linesByOrderId.get(line.purchaseOrderId) ?? [];
          bucket.push({ itemName: line.itemName, quantity: line.quantity });
          linesByOrderId.set(line.purchaseOrderId, bucket);
        });

        return orderRows.map((order) => ({
          ...order,
          status: order.status as PurchaseOrderStatus,
          purchaseBillStatus:
            order.purchaseBillStatus as PurchaseOrderListRow["purchaseBillStatus"],
          itemSummary: summarizeItems(linesByOrderId.get(order.id) ?? []),
        }));
      });
    },
    {
      successData: (orders) => ({
        rowCount: orders.length,
      }),
    },
  );
}

export async function getPurchaseOrder(
  id: string,
  options?: { includeDeleted?: boolean },
): Promise<PurchaseOrderDetail | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const conditions = [eq(purchaseOrders.id, id)];

    if (!options?.includeDeleted) {
      conditions.push(isNull(purchaseOrders.deletedAt));
    }

    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        supplierId: purchaseOrders.supplierId,
        supplierName: purchaseOrders.supplierName,
        supplierEmail: suppliers.email,
        status: purchaseOrders.status,
        expectedDate: purchaseOrders.expectedDate,
        notes: purchaseOrders.notes,
        accountingPurchaseAccountCode:
          purchaseOrders.accountingPurchaseAccountCode,
        shipLine1: purchaseOrders.shipLine1,
        shipLine2: purchaseOrders.shipLine2,
        shipCity: purchaseOrders.shipCity,
        shipRegion: purchaseOrders.shipRegion,
        shipPostcode: purchaseOrders.shipPostcode,
        shipCountry: purchaseOrders.shipCountry,
        shippingCost: trimScale(purchaseOrders.shippingCost).as("shippingCost"),
        subtotalAmount: trimScale(purchaseOrders.subtotalAmount).as("subtotalAmount"),
        taxAmount: trimScale(purchaseOrders.taxAmount).as("taxAmount"),
        totalAmount: trimScale(purchaseOrders.totalAmount).as("totalAmount"),
        orderedAt: purchaseOrders.orderedAt,
        receivedAt: purchaseOrders.receivedAt,
        cancelledAt: purchaseOrders.cancelledAt,
        xeroPurchaseOrderId: purchaseOrderSyncs.externalDocumentId,
        xeroPurchaseOrderNumber: purchaseOrderSyncs.externalDocumentNumber,
        xeroPushStatus: purchaseOrderSyncs.pushStatus,
        xeroPushError: purchaseOrderSyncs.pushError,
        xeroPushedAt: purchaseOrderSyncs.pushedAt,
        xeroPushPayloadHash: purchaseOrderSyncs.pushPayloadHash,
        xeroLastPushAttemptAt: purchaseOrderSyncs.lastPushAttemptAt,
        xeroRetryCount: sql<number>`COALESCE(${purchaseOrderSyncs.retryCount}, 0)`,
        xeroPoEmailStatus: purchaseOrderSyncs.emailStatus,
        xeroPoEmailError: purchaseOrderSyncs.emailError,
        xeroPoEmailedAt: purchaseOrderSyncs.emailedAt,
        purchaseBillExternalId: purchaseBillSyncs.externalDocumentId,
        purchaseBillExternalNumber: purchaseBillSyncs.externalDocumentNumber,
        purchaseBillStatus: purchaseBillSyncs.pushStatus,
        purchaseBillError: purchaseBillSyncs.pushError,
        purchaseBillPushedAt: purchaseBillSyncs.pushedAt,
        purchaseBillPayloadSnapshot: purchaseBillSyncs.pushPayloadSnapshot,
        deletedAt: purchaseOrders.deletedAt,
        createdAt: purchaseOrders.createdAt,
        updatedAt: purchaseOrders.updatedAt,
      })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(
        purchaseOrderSyncs,
        and(
          eq(purchaseOrderSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(purchaseOrderSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_ORDER),
          eq(purchaseOrderSyncs.documentId, purchaseOrders.id),
        ),
      )
      .leftJoin(
        purchaseBillSyncs,
        and(
          eq(purchaseBillSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(purchaseBillSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
          eq(purchaseBillSyncs.documentId, purchaseOrders.id),
        ),
      )
      .where(and(...conditions));

    if (!order) {
      return null;
    }

    const [lines, additionalCosts, attachments, taxSettings] = await Promise.all([
      getPurchaseOrderLinesInTx(tx, id),
      getPurchaseOrderAdditionalCostsInTx(tx, id),
      getPurchaseOrderAttachmentsInTx(tx, id),
      getTaxSettingsInTx(tx, orgId),
    ]);
    const landedCosts = calculatePurchaseOrderLandedCosts({
      lines: lines.map((line) => ({
        quantityOrdered: line.quantityOrdered,
        unitCost: line.unitCost,
        purchaseToStockFactor: line.purchaseToStockFactor,
      })),
      additionalCosts,
      legacyShippingCost: order.shippingCost,
    });

    return {
      ...order,
      status: order.status as PurchaseOrderStatus,
      xeroPushStatus:
        order.xeroPushStatus as PurchaseOrderDetail["xeroPushStatus"],
      xeroPoEmailStatus:
        order.xeroPoEmailStatus as PurchaseOrderDetail["xeroPoEmailStatus"],
      purchaseBillStatus:
        order.purchaseBillStatus as PurchaseOrderDetail["purchaseBillStatus"],
      lines: lines.map((line, index) => {
        const lineCosts = landedCosts.lines[index];

        return {
          ...line,
          stockUnitCost:
            normalizeLandedStockUnitCost(lineCosts.landedStockUnitCost) ??
            line.stockUnitCost,
          allocatedAdditionalCost: normalizeLandedMoney(
            lineCosts.allocatedAdditionalCost,
          ),
          landedCost: normalizeLandedMoney(lineCosts.landedLineTotal),
          quantityRemaining: normalizeNumeric(
            parseFloat(line.quantityOrdered) -
              parseFloat(line.quantityReceived),
          ),
          stockQuantityRemaining: normalizeNumeric(
            parseFloat(line.stockQuantityOrdered) -
              parseFloat(line.stockQuantityReceived),
          ),
        };
      }) as PurchaseOrderDetailLine[],
      taxRates: taxSettings.rates,
      defaultTaxRateId: taxSettings.defaultPurchaseTaxRateId,
      additionalCosts: additionalCosts.map((cost) => ({
        ...cost,
        costType:
          cost.costType as PurchaseOrderDetail["additionalCosts"][number]["costType"],
        distributionMethod:
          cost.distributionMethod as PurchaseOrderDetail["additionalCosts"][number]["distributionMethod"],
      })),
      attachments,
    };
  });
}

export async function getEditablePurchaseOrder(
  id: string,
): Promise<PurchaseOrderEditData | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        supplierId: purchaseOrders.supplierId,
        status: purchaseOrders.status,
        expectedDate: purchaseOrders.expectedDate,
        notes: purchaseOrders.notes,
        accountingPurchaseAccountCode:
          purchaseOrders.accountingPurchaseAccountCode,
        shipLine1: purchaseOrders.shipLine1,
        shipLine2: purchaseOrders.shipLine2,
        shipCity: purchaseOrders.shipCity,
        shipRegion: purchaseOrders.shipRegion,
        shipPostcode: purchaseOrders.shipPostcode,
        shipCountry: purchaseOrders.shipCountry,
        shippingCost: trimScale(purchaseOrders.shippingCost).as("shippingCost"),
        purchaseBillExternalId: purchaseBillSyncs.externalDocumentId,
        purchaseBillExternalNumber: purchaseBillSyncs.externalDocumentNumber,
        purchaseBillStatus: purchaseBillSyncs.pushStatus,
        purchaseBillError: purchaseBillSyncs.pushError,
      })
      .from(purchaseOrders)
      .leftJoin(
        purchaseBillSyncs,
        and(
          eq(purchaseBillSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(purchaseBillSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
          eq(purchaseBillSyncs.documentId, purchaseOrders.id),
        ),
      )
      .where(
        and(
          eq(purchaseOrders.id, id),
          isNull(purchaseOrders.deletedAt),
          inArray(purchaseOrders.status, [
            "draft",
            "ordered",
            "partial",
            "received",
            "cancelled",
          ]),
        ),
      );

    if (!order) {
      return null;
    }

    const [lines, additionalCosts, attachments, taxSettings] = await Promise.all([
      getPurchaseOrderLinesInTx(tx, id),
      getPurchaseOrderAdditionalCostsInTx(tx, id),
      getPurchaseOrderAttachmentsInTx(tx, id),
      getTaxSettingsInTx(tx, orgId),
    ]);

    return {
      ...order,
      status: order.status as PurchaseOrderEditData["status"],
      purchaseBillStatus:
        order.purchaseBillStatus as PurchaseOrderEditData["purchaseBillStatus"],
      lines: lines.map((line) => ({
        itemId: line.itemId,
        quantityOrdered: line.quantityOrdered,
        quantityReceived: line.quantityReceived,
        stockQuantityReceived: line.stockQuantityReceived,
        unitCost: line.unitCost,
        taxRateId: line.taxRateId,
        accountingPurchaseAccountCode: line.accountingPurchaseAccountCode,
        shipAddressEntryId: line.shipAddressEntryId,
        shipContactName: line.shipContactName,
        shipContactPhone: line.shipContactPhone,
        shipLine1: line.shipLine1,
        shipLine2: line.shipLine2,
        shipCity: line.shipCity,
        shipRegion: line.shipRegion,
        shipPostcode: line.shipPostcode,
        shipCountry: line.shipCountry,
        shipDeliveryInstructions: line.shipDeliveryInstructions,
      })),
      taxRates: taxSettings.rates,
      defaultTaxRateId: taxSettings.defaultPurchaseTaxRateId,
      additionalCosts: additionalCosts.map((cost) => ({
        costType:
          cost.costType as PurchaseOrderEditData["additionalCosts"][number]["costType"],
        reference: cost.reference,
        distributionMethod:
          cost.distributionMethod as PurchaseOrderEditData["additionalCosts"][number]["distributionMethod"],
        accountingPurchaseAccountCode: cost.accountingPurchaseAccountCode,
        amount: cost.amount,
      })),
      attachments,
    };
  });
}

export async function getPurchaseOrderFileUploadTarget(id: string) {
  return withAuthedOrgContext(async (tx) => getActivePurchaseOrderInTx(tx, id));
}

export async function createPurchaseOrderAttachment(params: {
  purchaseOrderId: string;
  storageKey: string;
  blobUrl: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: { userId: string; name: string };
}): Promise<PurchaseOrderAttachment | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const order = await getActivePurchaseOrderInTx(tx, params.purchaseOrderId);
    if (!order) return null;

    const [file] = await tx
      .insert(attachmentFiles)
      .values({
        organizationId: orgId,
        ownerType: ATTACHMENT_OWNER_PURCHASE_ORDER,
        ownerId: params.purchaseOrderId,
        storageKey: params.storageKey,
        blobUrl: params.blobUrl,
        filename: params.filename,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        uploadedByUserId: params.uploadedBy.userId,
        uploadedByName: params.uploadedBy.name,
      })
      .returning({
        id: attachmentFiles.id,
        filename: attachmentFiles.filename,
        contentType: attachmentFiles.contentType,
        sizeBytes: attachmentFiles.sizeBytes,
        uploadedByName: attachmentFiles.uploadedByName,
        createdAt: attachmentFiles.createdAt,
      });

    return mapPurchaseOrderAttachment({
      ...file,
      syncStatus: null,
      syncError: null,
      syncedAt: null,
    });
  });
}

export async function getPurchaseOrderAttachmentForDownload(
  purchaseOrderId: string,
  fileId: string,
) {
  return withAuthedOrgContext(async (tx) => {
    const [file] = await tx
      .select({
        id: attachmentFiles.id,
        blobUrl: attachmentFiles.blobUrl,
        filename: attachmentFiles.filename,
        contentType: attachmentFiles.contentType,
        sizeBytes: attachmentFiles.sizeBytes,
      })
      .from(attachmentFiles)
      .where(
        and(
          eq(attachmentFiles.id, fileId),
          eq(attachmentFiles.ownerType, ATTACHMENT_OWNER_PURCHASE_ORDER),
          eq(attachmentFiles.ownerId, purchaseOrderId),
          isNull(attachmentFiles.deletedAt),
        ),
      );

    return file ?? null;
  });
}

export async function deletePurchaseOrderAttachment(
  purchaseOrderId: string,
  fileId: string,
) {
  return withAuthedOrgContext(async (tx) => {
    const [file] = await tx
      .update(attachmentFiles)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(attachmentFiles.id, fileId),
          eq(attachmentFiles.ownerType, ATTACHMENT_OWNER_PURCHASE_ORDER),
          eq(attachmentFiles.ownerId, purchaseOrderId),
          isNull(attachmentFiles.deletedAt),
        ),
      )
      .returning({
        id: attachmentFiles.id,
        blobUrl: attachmentFiles.blobUrl,
      });

    return file ?? null;
  });
}

export async function createPurchaseOrderInTx(
  tx: Tx,
  orgId: string,
  data: PurchaseOrderPayload,
  options: CreatePurchaseOrderDraftOptions = {},
) {
  const prepared = await preparePurchaseOrderPayload(tx, orgId, data);
  const orderNumber = options.orderNumber ?? (await generateOrderNumber(tx));

  const [order] = await tx
    .insert(purchaseOrders)
    .values({
      organizationId: orgId,
      orderNumber,
      supplierId: prepared.supplierId,
      supplierName: prepared.supplierName,
      status: "draft",
      expectedDate: prepared.expectedDate,
      notes: prepared.notes,
      accountingPurchaseAccountCode: prepared.accountingPurchaseAccountCode,
      shipLine1: prepared.shipLine1,
      shipLine2: prepared.shipLine2,
      shipCity: prepared.shipCity,
      shipRegion: prepared.shipRegion,
      shipPostcode: prepared.shipPostcode,
      shipCountry: prepared.shipCountry,
      shippingCost: prepared.shippingCost,
      subtotalAmount: prepared.subtotalAmount,
      taxAmount: prepared.taxAmount,
      totalAmount: prepared.totalAmount,
    })
    .returning({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
    });

  if (
    options.accountingPushStatus === "pushed" &&
    options.externalPurchaseOrderId
  ) {
    await persistAccountingDocumentPushSuccess(tx, {
      organizationId: orgId,
      provider: options.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
      documentId: order.id,
      externalDocumentId: options.externalPurchaseOrderId,
      externalDocumentNumber:
        options.externalPurchaseOrderNumber ?? options.externalPurchaseOrderId,
      payloadHash: "",
    });
  }

  if (prepared.preparedLines.length > 0) {
    await tx.insert(purchaseOrderLines).values(
      prepared.preparedLines.map((line) => ({
        purchaseOrderId: order.id,
        ...line,
      })),
    );
  }

  if (prepared.preparedAdditionalCosts.length > 0) {
    await tx.insert(purchaseOrderAdditionalCosts).values(
      prepared.preparedAdditionalCosts.map((cost) => ({
        purchaseOrderId: order.id,
        ...cost,
      })),
    );
  }

  return order;
}

export async function upsertImportedAccountingPurchaseOrderInTx(
  tx: Tx,
  orgId: string,
  data: ImportedAccountingPurchaseOrder,
  options: { actorUserId?: string | null } = {},
) {
  const prepared = await preparePurchaseOrderPayload(tx, orgId, data);
  const [existingByExternal] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
    })
    .from(accountingDocumentSyncs)
    .innerJoin(
      purchaseOrders,
      eq(accountingDocumentSyncs.documentId, purchaseOrders.id),
    )
    .where(
      and(
        eq(accountingDocumentSyncs.organizationId, orgId),
        eq(accountingDocumentSyncs.provider, data.accountingProvider),
        eq(
          accountingDocumentSyncs.documentType,
          ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
        ),
        eq(
          accountingDocumentSyncs.externalDocumentId,
          data.externalPurchaseOrderId,
        ),
        isNull(purchaseOrders.deletedAt),
      ),
    )
    .limit(1);
  const [existingByNumber] = existingByExternal
    ? [null]
    : await tx
        .select({
          id: purchaseOrders.id,
          status: purchaseOrders.status,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.organizationId, orgId),
            eq(purchaseOrders.orderNumber, data.orderNumber),
            isNull(purchaseOrders.deletedAt),
          ),
        )
        .limit(1);
  const existing = existingByExternal ?? existingByNumber;

  if (!existing) {
    const created = await createPurchaseOrderInTx(tx, orgId, data, {
      orderNumber: data.orderNumber,
      externalPurchaseOrderId: data.externalPurchaseOrderId,
      externalPurchaseOrderNumber: data.externalPurchaseOrderNumber,
      accountingPushStatus: "pushed",
      accountingProvider: data.accountingProvider,
    });
    await tx
      .update(purchaseOrders)
      .set({
        status: "ordered",
        orderedAt: data.orderedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, created.id));
    const lines = await getPurchaseOrderLinesInTx(tx, created.id);
    await addExpectedFromPurchaseInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: created.id,
      actorUserId: options.actorUserId ?? null,
      idempotencyKey: null,
      lines: lines.map((line) => ({
        purchaseOrderLineId: line.id,
        itemId: line.itemId,
        quantity: parseFloat(line.stockQuantityOrdered),
      })),
    });
    return { action: "created" as const, id: created.id, protected: false };
  }

  const [locked] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, existing.id))
    .for("update");
  if (!locked)
    return { action: "skipped" as const, id: existing.id, protected: true };

  const existingLines = await getPurchaseOrderLinesInTx(tx, existing.id);
  const hasReceivedLines = existingLines.some(
    (line) =>
      parseFloat(line.quantityReceived) > 0 ||
      parseFloat(line.stockQuantityReceived) > 0,
  );

  await lockItemsInTx(tx, [
    ...new Set([
      ...existingLines.map((line) => line.itemId),
      ...prepared.affectedItemIds,
    ]),
  ]);

  await tx
    .update(purchaseOrders)
    .set({
      supplierId: prepared.supplierId,
      supplierName: prepared.supplierName,
      expectedDate: prepared.expectedDate,
      notes: prepared.notes,
      accountingPurchaseAccountCode: prepared.accountingPurchaseAccountCode,
      shipLine1: prepared.shipLine1,
      shipLine2: prepared.shipLine2,
      shipCity: prepared.shipCity,
      shipRegion: prepared.shipRegion,
      shipPostcode: prepared.shipPostcode,
      shipCountry: prepared.shipCountry,
      shippingCost: hasReceivedLines ? undefined : prepared.shippingCost,
      subtotalAmount: hasReceivedLines ? undefined : prepared.subtotalAmount,
      taxAmount: hasReceivedLines ? undefined : prepared.taxAmount,
      totalAmount: hasReceivedLines ? undefined : prepared.totalAmount,
      status: locked.status === "draft" ? "ordered" : undefined,
      orderedAt:
        locked.status === "draft" ? (data.orderedAt ?? new Date()) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, existing.id));

  if (!hasReceivedLines) {
    await tx
      .delete(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, existing.id));
    const insertedLines =
      prepared.preparedLines.length > 0
        ? await tx
            .insert(purchaseOrderLines)
            .values(
              prepared.preparedLines.map((line) => ({
                purchaseOrderId: existing.id,
                ...line,
              })),
            )
            .returning({
              id: purchaseOrderLines.id,
              itemId: purchaseOrderLines.itemId,
              stockQuantityOrdered: trimScale(
                purchaseOrderLines.stockQuantityOrdered,
              ).as("stockQuantityOrdered"),
            })
        : [];

    const nextLines = insertedLines.map((line) => ({
      purchaseOrderLineId: line.id,
      itemId: line.itemId,
      quantity: parseFloat(line.stockQuantityOrdered),
    }));

    if (locked.status === "draft") {
      await addExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: existing.id,
        actorUserId: options.actorUserId ?? null,
        idempotencyKey: null,
        lines: nextLines,
      });
    } else if (["ordered", "partial", "received"].includes(locked.status)) {
      await editExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: existing.id,
        actorUserId: options.actorUserId ?? null,
        idempotencyKey: null,
        previousPurchaseOrderLineIds: existingLines.map((line) => line.id),
        nextLines,
      });
    }

    await tx
      .delete(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, existing.id));
    if (prepared.preparedAdditionalCosts.length > 0) {
      await tx.insert(purchaseOrderAdditionalCosts).values(
        prepared.preparedAdditionalCosts.map((cost) => ({
          purchaseOrderId: existing.id,
          ...cost,
        })),
      );
    }
  }

  await persistAccountingDocumentPushSuccess(tx, {
    organizationId: orgId,
    provider: data.accountingProvider,
    documentType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
    documentId: existing.id,
    externalDocumentId: data.externalPurchaseOrderId,
    externalDocumentNumber: data.externalPurchaseOrderNumber,
    payloadHash: "",
  });

  return {
    action: "updated" as const,
    id: existing.id,
    protected: hasReceivedLines,
  };
}

export async function createPurchaseOrder(data: InsertPurchaseOrder) {
  return withAuthedOrgContext((tx, orgId) =>
    createPurchaseOrderInTx(tx, orgId, data),
  );
}

export async function duplicatePurchaseOrder(id: string) {
  const order = await getPurchaseOrder(id);

  if (!order) {
    return null;
  }

  return createPurchaseOrder({
    supplierId: order.supplierId,
    expectedDate: order.expectedDate,
    shippingCost: order.shippingCost,
    notes: order.notes,
    accountingPurchaseAccountCode: order.accountingPurchaseAccountCode,
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
    lines: order.lines.map((line) => ({
      itemId: line.itemId,
      quantityOrdered: line.quantityOrdered,
      unitCost: line.unitCost,
      taxRateId: line.taxRateId,
      accountingPurchaseAccountCode: line.accountingPurchaseAccountCode,
      shipAddressEntryId: line.shipAddressEntryId,
      shipContactName: line.shipContactName,
      shipContactPhone: line.shipContactPhone,
      shipLine1: line.shipLine1,
      shipLine2: line.shipLine2,
      shipCity: line.shipCity,
      shipRegion: line.shipRegion,
      shipPostcode: line.shipPostcode,
      shipCountry: line.shipCountry,
      shipDeliveryInstructions: line.shipDeliveryInstructions,
    })),
    additionalCosts: order.additionalCosts.map((cost) => ({
      costType: cost.costType,
      reference: cost.reference,
      distributionMethod: cost.distributionMethod,
      accountingPurchaseAccountCode: cost.accountingPurchaseAccountCode,
      amount: cost.amount,
    })),
  });
}

export async function updatePurchaseOrder(
  id: string,
  data: UpdatePurchaseOrder,
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      return null;
    }

    const [purchaseBillSync] = await tx
      .select({
        externalDocumentId: accountingDocumentSyncs.externalDocumentId,
        pushStatus: accountingDocumentSyncs.pushStatus,
      })
      .from(accountingDocumentSyncs)
      .where(
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
          eq(accountingDocumentSyncs.documentId, id),
        ),
      );

    if (
      purchaseBillSync?.pushStatus === "pushed" &&
      purchaseBillSync.externalDocumentId
    ) {
      throw new PurchasingError(
        "This purchase order already has a Xero bill. Void it in Xero before editing the purchase order.",
        409,
      );
    }

    const prepared = await preparePurchaseOrderPayload(tx, orgId, data);
    const existingLines = await getPurchaseOrderLinesInTx(tx, id);
    const existingLineByItemId = new Map(
      existingLines.map((line) => [line.itemId, line]),
    );
    await lockItemsInTx(tx, [
      ...new Set([
        ...existingLines.map((line) => line.itemId),
        ...prepared.affectedItemIds,
      ]),
    ]);

    if (order.status !== "draft") {
      if (prepared.preparedLines.length === 0) {
        throw new PurchasingError(
          "Ordered purchase orders must have at least one material.",
          400,
        );
      }

      const nextItemIds = new Set(
        prepared.preparedLines.map((line) => line.itemId),
      );
      const nextExpectedLines: Array<{
        purchaseOrderLineId: string;
        itemId: string;
        quantity: number;
      }> = [];

      for (const line of prepared.preparedLines) {
        const existingLine = existingLineByItemId.get(line.itemId);
        if (existingLine) {
          const quantityReceived = parseFloat(existingLine.quantityReceived);
          const stockQuantityReceived = parseFloat(
            existingLine.stockQuantityReceived,
          );
          if (
            parseFloat(line.quantityOrdered) < quantityReceived ||
            parseFloat(line.stockQuantityOrdered) < stockQuantityReceived
          ) {
            throw new PurchasingError(
              "Ordered quantity cannot be less than quantity already received.",
              400,
            );
          }

          await tx
            .update(purchaseOrderLines)
            .set({
              itemName: line.itemName,
              itemSku: line.itemSku,
              purchaseUnitName: line.purchaseUnitName,
              stockingUnitName: line.stockingUnitName,
              purchaseToStockFactor: line.purchaseToStockFactor,
              quantityOrdered: line.quantityOrdered,
              stockQuantityOrdered: line.stockQuantityOrdered,
              unitCost: line.unitCost,
              stockUnitCost: line.stockUnitCost,
              taxRateId: line.taxRateId,
              taxRateName: line.taxRateName,
              taxRatePercent: line.taxRatePercent,
              accountingPurchaseAccountCode: line.accountingPurchaseAccountCode,
              shipAddressEntryId: line.shipAddressEntryId,
              shipContactName: line.shipContactName,
              shipContactPhone: line.shipContactPhone,
              shipLine1: line.shipLine1,
              shipLine2: line.shipLine2,
              shipCity: line.shipCity,
              shipRegion: line.shipRegion,
              shipPostcode: line.shipPostcode,
              shipCountry: line.shipCountry,
              shipDeliveryInstructions: line.shipDeliveryInstructions,
              lineSubtotal: line.lineSubtotal,
              lineTaxAmount: line.lineTaxAmount,
              lineTotal: line.lineTotal,
              sortOrder: line.sortOrder,
              updatedAt: new Date(),
            })
            .where(eq(purchaseOrderLines.id, existingLine.id));

          nextExpectedLines.push({
            purchaseOrderLineId: existingLine.id,
            itemId: line.itemId,
            quantity: Math.max(
              parseFloat(line.stockQuantityOrdered) -
                parseFloat(existingLine.stockQuantityReceived),
              0,
            ),
          });
          continue;
        }

        const [insertedLine] = await tx
          .insert(purchaseOrderLines)
          .values({
            purchaseOrderId: id,
            ...line,
          })
          .returning({ id: purchaseOrderLines.id });

        nextExpectedLines.push({
          purchaseOrderLineId: insertedLine.id,
          itemId: line.itemId,
          quantity: parseFloat(line.stockQuantityOrdered),
        });
      }

      const removedLines = existingLines.filter(
        (line) => !nextItemIds.has(line.itemId),
      );
      const receivedRemovedLine = removedLines.find(
        (line) =>
          parseFloat(line.quantityReceived) > 0 ||
          parseFloat(line.stockQuantityReceived) > 0,
      );
      if (receivedRemovedLine) {
        throw new PurchasingError(
          "Received purchase order lines cannot be removed.",
          400,
        );
      }

      if (["ordered", "partial", "received"].includes(order.status)) {
        await editExpectedFromPurchaseInTx(tx, {
          organizationId: orgId,
          purchaseOrderId: id,
          actorUserId: userId,
          idempotencyKey: null,
          nextLines: nextExpectedLines,
        });
      }

      const removedLineIds = removedLines.map((line) => line.id);
      if (removedLineIds.length > 0) {
        await tx
          .delete(purchaseOrderLines)
          .where(inArray(purchaseOrderLines.id, removedLineIds));
      }
    } else {
      await tx
        .delete(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, id));

      if (prepared.preparedLines.length > 0) {
        await tx.insert(purchaseOrderLines).values(
          prepared.preparedLines.map((line) => ({
            purchaseOrderId: id,
            ...line,
          })),
        );
      }
    }

    await tx
      .delete(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, id));
    if (prepared.preparedAdditionalCosts.length > 0) {
      await tx.insert(purchaseOrderAdditionalCosts).values(
        prepared.preparedAdditionalCosts.map((cost) => ({
          purchaseOrderId: id,
          ...cost,
        })),
      );
    }

    await tx
      .update(purchaseOrders)
      .set({
        supplierId: prepared.supplierId,
        supplierName: prepared.supplierName,
        expectedDate: prepared.expectedDate,
        notes: prepared.notes,
        accountingPurchaseAccountCode: prepared.accountingPurchaseAccountCode,
        shipLine1: prepared.shipLine1,
        shipLine2: prepared.shipLine2,
        shipCity: prepared.shipCity,
        shipRegion: prepared.shipRegion,
        shipPostcode: prepared.shipPostcode,
        shipCountry: prepared.shipCountry,
        shippingCost: prepared.shippingCost,
        subtotalAmount: prepared.subtotalAmount,
        taxAmount: prepared.taxAmount,
        totalAmount: prepared.totalAmount,
        status:
          order.status === "received" &&
          prepared.preparedLines.some((line) => {
            const existingLine = existingLineByItemId.get(line.itemId);
            return (
              parseFloat(line.stockQuantityOrdered) >
              parseFloat(existingLine?.stockQuantityReceived ?? "0")
            );
          })
            ? "partial"
            : undefined,
        receivedAt:
          order.status === "received" &&
          prepared.preparedLines.some((line) => {
            const existingLine = existingLineByItemId.get(line.itemId);
            return (
              parseFloat(line.stockQuantityOrdered) >
              parseFloat(existingLine?.stockQuantityReceived ?? "0")
            );
          })
            ? null
            : undefined,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    if (["ordered", "partial", "received"].includes(order.status)) {
      await tx
        .update(accountingDocumentSyncs)
        .set({
          pushStatus: sql`
            CASE
              WHEN ${accountingDocumentSyncs.externalDocumentId} IS NOT NULL THEN 'pending'
              ELSE ${accountingDocumentSyncs.pushStatus}
            END
          `,
          pushError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
            eq(
              accountingDocumentSyncs.documentType,
              ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
            ),
            eq(accountingDocumentSyncs.documentId, id),
          ),
        );
    }

    return { id };
  });
}

export async function submitPurchaseOrder(
  id: string,
  options?: {
    idempotencyKey?: string;
    syncAccounting?: boolean;
    sendEmail?: boolean;
  },
) {
  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(
      tx,
      {
        organizationId: orgId,
        operationName: "submitPurchaseOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: {
          id,
          syncAccounting: options?.syncAccounting ?? true,
          sendEmail: options?.sendEmail ?? false,
        },
      },
    );

    if (replay.replayed) {
      return {
        replayed: true as const,
        submitted: replay.result,
        orgId,
      };
    }

    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return {
        replayed: false as const,
        submitted: null,
        orgId,
      };
    }

    if (order.status !== "draft") {
      throw new PurchasingError(
        "Only draft purchase orders can be submitted.",
        400,
      );
    }

    const lines = await getPurchaseOrderLinesInTx(tx, id);
    if (lines.length === 0) {
      throw new PurchasingError(
        "Add at least one material before ordering this purchase order.",
        400,
      );
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: "ordered",
        orderedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await addExpectedFromPurchaseInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "submit-order",
      ),
      lines: lines.map((line) => ({
        purchaseOrderLineId: line.id,
        itemId: line.itemId,
        quantity: parseFloat(line.stockQuantityOrdered),
      })),
    });

    const submitted = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: submitted,
    });

    return {
      replayed: false as const,
      submitted,
      orgId,
    };
  });

  if (!result.submitted) {
    return null;
  }

  if (result.replayed) {
    return result.submitted;
  }

  if (options?.syncAccounting === false) {
    return result.submitted;
  }

  const { getXeroAutomationSettingsForOrg } = await import("@/lib/dal/xero");
  const automation = await getXeroAutomationSettingsForOrg(result.orgId);
  if (!automation?.autoPushPurchaseOrders) {
    return result.submitted;
  }

  // Stock + expected-supply tx has committed. Attempt the Xero PO push;
  // a failure must NOT roll back the submit — the order is ordered
  // regardless of accounting state.
  const { pushPurchaseOrderToXero, markXeroPurchaseOrderPushFailed } =
    await import("@/lib/xero/push-purchase-order");
  const { XeroError } = await import("@/lib/xero/errors");

  try {
    await pushPurchaseOrderToXero(result.orgId, id, {
      sendEmail: options?.sendEmail,
    });
  } catch (error) {
    if (
      error instanceof XeroError &&
      (error.message.includes("not connected") ||
        error.status === 409 ||
        error.status === 500)
    ) {
      if (!error.message.includes("not connected")) {
        await markXeroPurchaseOrderPushFailed(result.orgId, id, error);
      }
    } else {
      await markXeroPurchaseOrderPushFailed(result.orgId, id, error);
    }
  }

  return result.submitted;
}

export async function retryXeroPushForPurchaseOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { pushPurchaseOrderToXero, markXeroPurchaseOrderPushFailed } =
      await import("@/lib/xero/push-purchase-order");
    const { XeroError } = await import("@/lib/xero/errors");

    try {
      const result = await pushPurchaseOrderToXero(orgId, id);
      return { ok: true as const, result };
    } catch (error) {
      if (
        error instanceof XeroError &&
        (error.status === 404 || error.status === 409)
      ) {
        throw error;
      }

      await markXeroPurchaseOrderPushFailed(orgId, id, error);
      throw error;
    }
  });
}

export async function retryXeroEmailForPurchaseOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { emailPurchaseOrderForOrder } =
      await import("@/lib/xero/push-purchase-order");
    const result = await emailPurchaseOrderForOrder(orgId, id);
    return { ok: true as const, result };
  });
}

export async function createPurchaseBillAccountingSync(
  id: string,
  data: CreatePurchaseBill,
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const { createPurchaseBillAccountingSync, markXeroPurchaseBillPushFailed } =
      await import("@/lib/xero/push-purchase-bill");
    const { XeroError } = await import("@/lib/xero/errors");
    try {
      const result = await createPurchaseBillAccountingSync(orgId, id, data);
      return { ok: true as const, result };
    } catch (error) {
      const [sync] = await tx
        .select({ pushStatus: accountingDocumentSyncs.pushStatus })
        .from(accountingDocumentSyncs)
        .where(
          and(
            eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
            eq(
              accountingDocumentSyncs.documentType,
              ACCOUNTING_DOCUMENT_PURCHASE_BILL,
            ),
            eq(accountingDocumentSyncs.documentId, id),
          ),
        );

      const isExpectedPreflight =
        error instanceof XeroError &&
        (error.status === 404 ||
          error.message.includes("not connected") ||
          error.message.includes("already running"));

      if (sync?.pushStatus === "pending" && !isExpectedPreflight) {
        await markXeroPurchaseBillPushFailed(orgId, id, error);
      }
      throw error;
    }
  });
}

export async function receivePurchaseOrder(
  id: string,
  data: ReceivePurchaseOrder,
  options?: { idempotencyKey?: string },
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(
      tx,
      {
        organizationId: orgId,
        operationName: "receivePurchaseOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { id, data },
      },
    );

    if (replay.replayed) {
      return replay.result;
    }

    // Lock the PO row first to prevent concurrent receipts from
    // reading stale quantityReceived values on the lines.
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        shippingCost: trimScale(purchaseOrders.shippingCost).as("shippingCost"),
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .for("update");

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (!["ordered", "partial"].includes(order.status)) {
      throw new PurchasingError(
        "Only ordered or partially received purchase orders can be received.",
        400,
      );
    }

    const [existingLines, additionalCosts] = await Promise.all([
      getPurchaseOrderLinesInTx(tx, id),
      getPurchaseOrderAdditionalCostsInTx(tx, id),
    ]);
    const lineMap = new Map(existingLines.map((line) => [line.id, line]));
    const seenLineIds = new Set<string>();
    const overReceiptWarnings: Array<{
      lineId: string;
      itemName: string;
      remaining: string;
      requested: string;
      overage: string;
    }> = [];
    const receiveEntries = data.lines.map((line, index) => {
      if (seenLineIds.has(line.lineId)) {
        throw new PurchasingError("Duplicate receipt line", 400, {
          errors: {
            [`lines.${index}.quantityReceived`]: [
              "Each line can only be received once per submission",
            ],
          },
        });
      }
      seenLineIds.add(line.lineId);

      const existingLine = lineMap.get(line.lineId);

      if (!existingLine) {
        throw new PurchasingError("Purchase order line not found", 404, {
          errors: {
            [`lines.${index}.quantityReceived`]: [
              "Select a valid purchase order line",
            ],
          },
        });
      }

      const quantityReceived = Number(line.quantityReceived);
      const remaining =
        parseFloat(existingLine.quantityOrdered) -
        parseFloat(existingLine.quantityReceived);

      if (quantityReceived > remaining && !data.confirmOverReceipt) {
        overReceiptWarnings.push({
          lineId: line.lineId,
          itemName: existingLine.itemName,
          remaining: normalizeNumeric(remaining),
          requested: normalizeNumeric(quantityReceived),
          overage: normalizeNumeric(quantityReceived - remaining),
        });
      } else if (quantityReceived > remaining && remaining < 0) {
        throw new PurchasingError(
          "Cannot receive more than remaining quantity.",
          400,
          {
            errors: {
              [`lines.${index}.quantityReceived`]: [
                `Must be ${normalizeNumeric(remaining)} or less`,
              ],
            },
          },
        );
      }

      const stockQuantityReceived = parseFloat(
        normalizeNumeric(
          quantityReceived * parseFloat(existingLine.purchaseToStockFactor),
        ),
      );

      return {
        line: existingLine,
        quantityReceived,
        stockQuantityReceived,
        disposition: line.disposition,
        overReceiptQuantity: Math.max(
          0,
          quantityReceived - Math.max(remaining, 0),
        ),
      };
    });

    if (overReceiptWarnings.length > 0) {
      throw new PurchasingError(
        "This receipt is above the ordered quantity.",
        409,
        {
          overReceipt: { lines: overReceiptWarnings },
        },
      );
    }

    await getValidatedMaterialsInTx(
      tx,
      receiveEntries.map((entry) => entry.line.itemId),
    );

    await lockItemsInTx(
      tx,
      existingLines.map((line) => line.itemId),
    );

    for (const [index, entry] of receiveEntries.entries()) {
      if (
        entry.disposition !== "available" &&
        (await getItemLotTrackingModeInTx(tx, entry.line.itemId)) === "untracked"
      ) {
        throw new PurchasingError("Untracked items can only be received as available.", 400, {
          errors: {
            [`lines.${index}.disposition`]: [
              "Untracked items can only be received as available.",
            ],
          },
        });
      }
    }

    const updatedLines = new Map(
      existingLines.map((line) => [line.id, { ...line }]),
    );

    for (const entry of receiveEntries) {
      const currentLine = updatedLines.get(entry.line.id);

      if (!currentLine) {
        continue;
      }

      const newQuantityReceived =
        parseFloat(currentLine.quantityReceived) + entry.quantityReceived;
      const newStockQuantityReceived =
        parseFloat(currentLine.stockQuantityReceived) +
        entry.stockQuantityReceived;
      const newQuantityOrdered = Math.max(
        parseFloat(currentLine.quantityOrdered),
        newQuantityReceived,
      );
      const newStockQuantityOrdered = Math.max(
        parseFloat(currentLine.stockQuantityOrdered),
        newStockQuantityReceived,
      );

      const normalizedReceived = normalizeNumeric(newQuantityReceived);
      const normalizedStockReceived = normalizeNumeric(
        newStockQuantityReceived,
      );
      const normalizedOrdered = normalizeNumeric(newQuantityOrdered);
      const normalizedStockOrdered = normalizeNumeric(newStockQuantityOrdered);
      const lineSubtotal = newQuantityOrdered * parseFloat(currentLine.unitCost);
      const normalizedLineSubtotal = normalizeLandedMoney(lineSubtotal);
      const normalizedLineTaxAmount = calculateTaxAmount(
        lineSubtotal,
        currentLine.taxRatePercent,
        4,
      );
      const normalizedLineTotal = calculateTaxedLineTotal(
        lineSubtotal,
        normalizedLineTaxAmount,
        4,
      );

      await tx
        .update(purchaseOrderLines)
        .set({
          quantityOrdered: normalizedOrdered,
          stockQuantityOrdered: normalizedStockOrdered,
          quantityReceived: normalizedReceived,
          stockQuantityReceived: normalizedStockReceived,
          lineSubtotal: normalizedLineSubtotal,
          lineTaxAmount: normalizedLineTaxAmount,
          lineTotal: normalizedLineTotal,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrderLines.id, currentLine.id));

      updatedLines.set(currentLine.id, {
        ...currentLine,
        quantityReceived: normalizedReceived,
        stockQuantityReceived: normalizedStockReceived,
        quantityOrdered: normalizedOrdered,
        stockQuantityOrdered: normalizedStockOrdered,
        lineSubtotal: normalizedLineSubtotal,
        lineTaxAmount: normalizedLineTaxAmount,
        lineTotal: normalizedLineTotal,
        updatedAt: new Date(),
      });
    }

    const overReceiptExpectedLines = existingLines.map((line) => {
      const currentLine = updatedLines.get(line.id);
      return {
        purchaseOrderLineId: line.id,
        itemId: line.itemId,
        quantity: Math.max(
          parseFloat(
            currentLine?.stockQuantityOrdered ?? line.stockQuantityOrdered,
          ) - parseFloat(line.stockQuantityReceived),
          0,
        ),
      };
    });

    if (receiveEntries.some((entry) => entry.overReceiptQuantity > 0)) {
      await editExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "over-receipt-expected",
        ),
        nextLines: overReceiptExpectedLines,
      });
    }

    const finalLines = existingLines.map(
      (line) => updatedLines.get(line.id) ?? line,
    );
    const finalLandedCosts = calculatePurchaseOrderLandedCosts({
      lines: finalLines.map((line) => ({
        quantityOrdered: line.quantityOrdered,
        unitCost: line.unitCost,
        purchaseToStockFactor: line.purchaseToStockFactor,
      })),
      additionalCosts,
      legacyShippingCost: order.shippingCost,
    });
    const landedStockUnitCostByLineId = new Map(
      finalLines.map((line, index) => [
        line.id,
        normalizeLandedStockUnitCost(
          finalLandedCosts.lines[index]?.landedStockUnitCost ?? null,
        ),
      ]),
    );

    if (receiveEntries.some((entry) => entry.overReceiptQuantity > 0)) {
      await Promise.all(
        finalLines.map((line) =>
          tx
            .update(purchaseOrderLines)
            .set({
              stockUnitCost:
                landedStockUnitCostByLineId.get(line.id) ?? line.stockUnitCost,
              updatedAt: new Date(),
            })
            .where(eq(purchaseOrderLines.id, line.id)),
        ),
      );
    }

    await receivePurchaseStockInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "receive-stock",
      ),
      lines: receiveEntries.map((entry) => ({
        purchaseOrderLineId: entry.line.id,
        itemId: entry.line.itemId,
        quantity: entry.stockQuantityReceived,
        unitCost:
          landedStockUnitCostByLineId.get(entry.line.id) ??
          entry.line.stockUnitCost,
        disposition: entry.disposition,
      })),
    });

    const allReceived = [...updatedLines.values()].every(
      (line) =>
        parseFloat(line.quantityReceived) >= parseFloat(line.quantityOrdered),
    );
    const finalTaxAmount = finalLines.reduce(
      (sum, line) => sum + Number(line.lineTaxAmount),
      0,
    );

    await tx
      .update(purchaseOrders)
      .set({
        status: allReceived ? "received" : "partial",
        receivedAt: allReceived ? new Date() : null,
        subtotalAmount: normalizeLandedMoney(finalLandedCosts.orderTotal),
        taxAmount: normalizeLandedMoney(finalTaxAmount),
        totalAmount: normalizeLandedMoney(
          finalLandedCosts.orderTotal + finalTaxAmount,
        ),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    const result = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function deletePurchaseOrder(
  id: string,
): Promise<{ deleted: boolean; error?: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      return { deleted: false };
    }

    if (["partial", "received"].includes(order.status)) {
      return {
        deleted: false,
        error:
          "Cannot delete this purchase order because inventory has already been received. Received inventory history must be preserved.",
      };
    }

    if (order.status === "ordered") {
      await releaseExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: id,
        actorUserId: userId,
        idempotencyKey: `delete-purchase-order:${id}`,
        reason: "deleted",
      });
    }

    await tx
      .update(purchaseOrders)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    return { deleted: true };
  });
}

export async function cancelPurchaseOrder(
  id: string,
  options?: { idempotencyKey?: string },
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(
      tx,
      {
        organizationId: orgId,
        operationName: "cancelPurchaseOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { id },
      },
    );

    if (replay.replayed) return replay.result;

    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (["partial", "received"].includes(order.status)) {
      throw new PurchasingError(
        "Cannot cancel this purchase order because inventory has already been received.",
        400,
      );
    }

    if (order.status === "ordered") {
      await releaseExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "cancel-order",
        ),
        reason: "cancelled",
      });
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    const result = { id };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

export async function deletePurchaseOrders(
  ids: string[],
): Promise<{ deletedCount: number; error?: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const uniqueIds = [...new Set(ids)];

    // Lock all candidate rows so status can't change between check and delete
    const orders = await tx
      .select({ id: purchaseOrders.id, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(
        and(
          inArray(purchaseOrders.id, uniqueIds),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .for("update");

    const receivedOrder = orders.find((o) =>
      ["partial", "received"].includes(o.status),
    );

    if (receivedOrder) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete the selected purchase orders because inventory has already been received for at least one order. Received inventory history must be preserved.",
      };
    }

    if (orders.length === 0) {
      return { deletedCount: 0 };
    }

    const orderIds = orders.map((o) => o.id);
    const deletedAt = new Date();

    for (const order of orders.filter((o) => o.status === "ordered")) {
      await releaseExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: order.id,
        actorUserId: userId,
        idempotencyKey: `delete-purchase-order:${order.id}`,
        reason: "deleted",
      });
    }

    const deleted = await tx
      .update(purchaseOrders)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(inArray(purchaseOrders.id, orderIds))
      .returning({ id: purchaseOrders.id });

    return { deletedCount: deleted.length };
  });
}
