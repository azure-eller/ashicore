import "server-only";

import {
  normalizeAddressFields,
  normalizeNumeric,
  summarizeItems,
} from "@/lib/format";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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
import type { AccountingProvider } from "@/lib/accounting/constants";
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
  groupPurchaseOrderByResolvedSupplier,
  resolvedAdditionalCostSupplierGroupKey,
} from "@/lib/purchasing/resolved-supplier-groups";
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
  revaluePurchaseLandedCostInTx,
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
import type { InsertSupplier, PatchSupplier, UpdateSupplier } from "@/lib/schemas/suppliers";
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
const additionalCostSuppliers = alias(
  suppliers,
  "additional_cost_suppliers",
);

function purchaseBillRollupStatusSql(
  documentId: typeof purchaseOrders.id,
  provider: AccountingProvider = ACCOUNTING_PROVIDER_XERO,
) {
  return sql<PurchaseOrderListRow["purchaseBillStatus"]>`(
    WITH billable_groups AS (
      SELECT po.supplier_id AS supplier_id
      FROM purchasing.purchase_orders po
      WHERE po.id = ${documentId}
        AND (
          EXISTS (
            SELECT 1
            FROM purchasing.purchase_order_lines line
            WHERE line.purchase_order_id = po.id
          )
          OR EXISTS (
            SELECT 1
            FROM purchasing.purchase_order_additional_costs cost
            WHERE cost.purchase_order_id = po.id
              AND COALESCE(cost.supplier_id, po.supplier_id) = po.supplier_id
          )
        )
      UNION
      SELECT DISTINCT cost.supplier_id AS supplier_id
      FROM purchasing.purchase_orders po
      JOIN purchasing.purchase_order_additional_costs cost
        ON cost.purchase_order_id = po.id
      WHERE po.id = ${documentId}
        AND cost.supplier_id IS NOT NULL
        AND cost.supplier_id <> po.supplier_id
    ),
    sync_rollup AS (
      SELECT
        bool_or(sync.push_status = 'failed') AS has_failed,
        bool_or(sync.push_status = 'pending') AS has_pending,
        count(*) FILTER (WHERE sync.push_status = 'pushed') AS pushed_count
      FROM accounting.document_syncs sync
      WHERE sync.provider = ${provider}
        AND sync.document_type = ${ACCOUNTING_DOCUMENT_PURCHASE_BILL}
        AND sync.document_id = ${documentId}
    )
    SELECT CASE
      WHEN sync_rollup.has_failed THEN 'failed'
      WHEN sync_rollup.has_pending THEN 'pending'
      WHEN sync_rollup.pushed_count >= GREATEST((SELECT count(*) FROM billable_groups), 1) THEN 'pushed'
      WHEN sync_rollup.pushed_count > 0 THEN 'pending'
      ELSE NULL
    END
    FROM sync_rollup
  )`;
}

function purchaseBillLatestFieldSql<T>(
  documentId: typeof purchaseOrders.id,
  field: string,
  provider: AccountingProvider = ACCOUNTING_PROVIDER_XERO,
) {
  return sql<T>`(
    SELECT ${sql.raw(field)}
    FROM accounting.document_syncs sync
    WHERE sync.provider = ${provider}
      AND sync.document_type = ${ACCOUNTING_DOCUMENT_PURCHASE_BILL}
      AND sync.document_id = ${documentId}
      AND sync.push_status = 'pushed'
    ORDER BY sync.pushed_at DESC NULLS LAST, sync.updated_at DESC NULLS LAST
    LIMIT 1
  )`;
}

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
  supplierId: string | null;
  distributionMethod: "by_value" | "not_distributed";
  accountingPurchaseAccountCode: string | null;
  amount: string;
  sortOrder: number;
};

type MaterialValidationRow = {
  id: string;
  itemType: string;
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
      orderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
      type: purchaseOrders.type,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

async function generateOrderNumber(tx: Tx, orgId: string) {
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await tx.execute(
      sql`SELECT nextval('purchasing.order_number_seq') AS val`,
    );
    const raw = (result.rows[0] as { val: string | number }).val;
    const sequenceValue = Number(raw);
    const orderNumber = `PO-${year}-${String(sequenceValue).padStart(4, "0")}`;

    const [existing] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.organizationId, orgId),
          eq(purchaseOrders.orderNumber, orderNumber),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) {
      return orderNumber;
    }
  }

  throw new PurchasingError(
    "Unable to generate a unique purchase order number.",
    500,
  );
}

async function resolvePurchaseOrderNumberInTx(
  tx: Tx,
  orgId: string,
  requested: string | null | undefined,
  options: { excludeId?: string } = {},
) {
  const orderNumber = requested?.trim();
  if (!orderNumber) {
    throw new PurchasingError("Purchase order number is required.", 400, {
      errors: {
        orderNumber: ["Purchase order number is required."],
      },
    });
  }

  const conditions = [
    eq(purchaseOrders.organizationId, orgId),
    eq(purchaseOrders.orderNumber, orderNumber),
    isNull(purchaseOrders.deletedAt),
  ];
  if (options.excludeId) {
    conditions.push(ne(purchaseOrders.id, options.excludeId));
  }

  const [existing] = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new PurchasingError(
      "A purchase order with this number already exists.",
      400,
      {
        errors: {
          orderNumber: ["A purchase order with this number already exists."],
        },
      },
    );
  }

  return orderNumber;
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

async function getPurchaseOrderAccountingGroupStatesInTx(
  tx: Tx,
  id: string,
  provider: AccountingProvider = ACCOUNTING_PROVIDER_XERO,
): Promise<PurchaseOrderDetail["accountingGroupStates"]> {
  const rows = await tx
    .select({
      groupKey: accountingDocumentSyncs.groupKey,
      documentType: accountingDocumentSyncs.documentType,
      pushStatus: accountingDocumentSyncs.pushStatus,
      pushError: accountingDocumentSyncs.pushError,
      externalDocumentId: accountingDocumentSyncs.externalDocumentId,
      externalDocumentNumber: accountingDocumentSyncs.externalDocumentNumber,
      pushedAt: accountingDocumentSyncs.pushedAt,
      emailStatus: accountingDocumentSyncs.emailStatus,
      emailError: accountingDocumentSyncs.emailError,
      emailedAt: accountingDocumentSyncs.emailedAt,
    })
    .from(accountingDocumentSyncs)
    .where(
      and(
        eq(accountingDocumentSyncs.provider, provider),
        eq(accountingDocumentSyncs.documentId, id),
        inArray(accountingDocumentSyncs.documentType, [
          ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
          ACCOUNTING_DOCUMENT_PURCHASE_BILL,
        ]),
      ),
    );

  const states = new Map<
    string,
    PurchaseOrderDetail["accountingGroupStates"][number]
  >();
  for (const row of rows) {
    const state =
      states.get(row.groupKey) ??
      {
        groupKey: row.groupKey,
        pushStatus: null,
        pushError: null,
        externalDocumentId: null,
        externalDocumentNumber: null,
        pushedAt: null,
        emailStatus: null,
        emailError: null,
        emailedAt: null,
      };
    if (row.documentType === ACCOUNTING_DOCUMENT_PURCHASE_BILL) {
      state.pushStatus =
        row.pushStatus as PurchaseOrderDetail["accountingGroupStates"][number]["pushStatus"];
      state.pushError = row.pushError;
      state.externalDocumentId = row.externalDocumentId;
      state.externalDocumentNumber = row.externalDocumentNumber;
      state.pushedAt = row.pushedAt;
    } else {
      state.emailStatus =
        row.emailStatus as PurchaseOrderDetail["accountingGroupStates"][number]["emailStatus"];
      state.emailError = row.emailError;
      state.emailedAt = row.emailedAt;
    }
    states.set(row.groupKey, state);
  }

  return [...states.values()];
}

async function getValidatedPurchasableItemsInTx(tx: Tx, itemIds: string[]) {
  const uniqueIds = [...new Set(itemIds)];

  const rows = await tx
    .select({
      id: items.id,
      itemType: sql<"material" | "product">`${items.itemType}`,
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
        inArray(items.itemType, ["material", "product"]),
        isNull(items.deletedAt),
      ),
    );

  const itemMap = new Map(
    rows.map((row) => [row.id, row as MaterialValidationRow]),
  );

  if (itemMap.size !== uniqueIds.length) {
    throw new PurchasingError("Item not found", 404);
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
      supplierId:
        purchaseOrderAdditionalCosts.supplierId,
      supplierName: additionalCostSuppliers.name,
      supplierEmail: additionalCostSuppliers.email,
      distributionMethod: purchaseOrderAdditionalCosts.distributionMethod,
      accountingPurchaseAccountCode:
        purchaseOrderAdditionalCosts.accountingPurchaseAccountCode,
      amount: trimScale(purchaseOrderAdditionalCosts.amount).as("amount"),
      sortOrder: purchaseOrderAdditionalCosts.sortOrder,
      createdAt: purchaseOrderAdditionalCosts.createdAt,
      updatedAt: purchaseOrderAdditionalCosts.updatedAt,
    })
    .from(purchaseOrderAdditionalCosts)
    .leftJoin(
      additionalCostSuppliers,
      eq(additionalCostSuppliers.id, purchaseOrderAdditionalCosts.supplierId),
    )
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, purchaseOrderId))
    .orderBy(
      asc(purchaseOrderAdditionalCosts.sortOrder),
      asc(purchaseOrderAdditionalCosts.createdAt),
    );
}

function normalizeAdditionalCostInputs(
  payload: PurchaseOrderPayload | UpdatePurchaseOrder,
) {
  return [...(payload.additionalCosts ?? [])];
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
  const materials = await getValidatedPurchasableItemsInTx(
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
  const additionalCostSupplierIds = [
    ...new Set(
      additionalCostInputs
        .map((cost) => cost.supplierId?.trim() ?? "")
        .filter(Boolean),
    ),
  ];
  if (additionalCostSupplierIds.length > 0) {
    const supplierRows = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          inArray(suppliers.id, additionalCostSupplierIds),
          isNull(suppliers.deletedAt),
        ),
      );
    const foundSupplierIds = new Set(supplierRows.map((row) => row.id));
    const missingSupplierId = additionalCostSupplierIds.find(
      (id) => !foundSupplierIds.has(id),
    );
    if (missingSupplierId) {
      throw new PurchasingError("Additional cost supplier not found.", 404);
    }
  }
  const preparedAdditionalCosts = additionalCostInputs.map((cost, index) => ({
    organizationId: orgId,
    costType: cost.costType,
    reference: cost.reference?.trim() || null,
    supplierId:
      cost.supplierId === supplier.id
        ? null
        : cost.supplierId?.trim() || null,
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
      throw new PurchasingError("Item not found", 404);
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

  const [blockingCost] = await tx
    .select({ id: purchaseOrderAdditionalCosts.id })
    .from(purchaseOrderAdditionalCosts)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrders.id, purchaseOrderAdditionalCosts.purchaseOrderId),
    )
    .where(
      and(
        inArray(
          purchaseOrderAdditionalCosts.supplierId,
          uniqueSupplierIds,
        ),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrders.status, ["draft", "ordered", "partial"]),
      ),
    )
    .limit(1);

  if (blockingCost) {
    throw new PurchasingError(
      "Cannot delete supplier used as a supplier on active draft, ordered, or partially received purchase orders.",
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
    return createSupplierInTx(tx, orgId, data);
  });
}

export async function createSupplierInTx(tx: Tx, orgId: string, data: InsertSupplier) {
  const [supplier] = await tx
    .insert(suppliers)
    .values({
      organizationId: orgId,
      ...data,
    })
    .returning({ id: suppliers.id, name: suppliers.name });

  return supplier;
}

export async function updateSupplier(id: string, data: UpdateSupplier) {
  return withAuthedOrgContext(async (tx) => {
    return updateSupplierInTx(tx, id, data);
  });
}

export async function patchSupplier(id: string, data: PatchSupplier) {
  return withAuthedOrgContext(async (tx) => {
    return patchSupplierInTx(tx, id, data);
  });
}

export async function updateSupplierInTx(tx: Tx, id: string, data: UpdateSupplier) {
  const [supplier] = await tx
    .update(suppliers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
    .returning({ id: suppliers.id });

  return supplier ?? null;
}

export async function patchSupplierInTx(tx: Tx, id: string, data: PatchSupplier) {
  const [supplier] = await tx
    .update(suppliers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
    .returning({ id: suppliers.id });

  return supplier ?? null;
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
        itemType: sql<"material" | "product">`${items.itemType}`,
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
      .where(
        and(inArray(items.itemType, ["material", "product"]), isNull(items.deletedAt))
      )
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
            supplierEmail: suppliers.email,
            accountingPurchaseAccountCode:
              purchaseOrders.accountingPurchaseAccountCode,
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
            purchaseBillManualStatus: purchaseOrders.purchaseBillManualStatus,
            purchaseBillStatus: purchaseBillRollupStatusSql(purchaseOrders.id),
            purchaseBillError: purchaseBillLatestFieldSql<string | null>(
              purchaseOrders.id,
              "sync.push_error",
            ),
            purchaseBillExternalId: purchaseBillLatestFieldSql<string | null>(
              purchaseOrders.id,
              "sync.external_document_id",
            ),
            purchaseBillExternalNumber: purchaseBillLatestFieldSql<string | null>(
              purchaseOrders.id,
              "sync.external_document_number",
            ),
            purchaseBillPushedAt: purchaseBillLatestFieldSql<Date | null>(
              purchaseOrders.id,
              "sync.pushed_at",
            ),
            xeroPoEmailStatus: purchaseOrderSyncs.emailStatus,
            xeroPoEmailError: purchaseOrderSyncs.emailError,
            xeroPoEmailedAt: purchaseOrderSyncs.emailedAt,
          })
          .from(purchaseOrders)
          .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
          .leftJoin(
            purchaseOrderSyncs,
            and(
              eq(purchaseOrderSyncs.provider, ACCOUNTING_PROVIDER_XERO),
              eq(purchaseOrderSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_ORDER),
              eq(purchaseOrderSyncs.documentId, purchaseOrders.id),
              eq(purchaseOrderSyncs.groupKey, "default"),
            ),
          )
          .where(
            and(
              isNull(purchaseOrders.deletedAt),
              eq(purchaseOrders.type, "standard"),
            ),
          )
          .orderBy(
            desc(purchaseOrders.createdAt),
            asc(purchaseOrders.orderNumber),
            asc(purchaseOrders.id),
          );

        if (orderRows.length === 0) {
          return [];
        }

        const orderIds = orderRows.map((order) => order.id);
        const [lines, additionalCosts] = await Promise.all([
          tx
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
            ),
          tx
            .select({
              purchaseOrderId: purchaseOrderAdditionalCosts.purchaseOrderId,
              amount: trimScale(purchaseOrderAdditionalCosts.amount).as("amount"),
            })
            .from(purchaseOrderAdditionalCosts)
            .where(inArray(purchaseOrderAdditionalCosts.purchaseOrderId, orderIds)),
        ]);

        const linesByOrderId = new Map<
          string,
          Array<{ itemName: string; quantity: string }>
        >();
        lines.forEach((line) => {
          const bucket = linesByOrderId.get(line.purchaseOrderId) ?? [];
          bucket.push({ itemName: line.itemName, quantity: line.quantity });
          linesByOrderId.set(line.purchaseOrderId, bucket);
        });
        const additionalCostTotalsByOrderId = new Map<string, number>();
        additionalCosts.forEach((cost) => {
          additionalCostTotalsByOrderId.set(
            cost.purchaseOrderId,
            (additionalCostTotalsByOrderId.get(cost.purchaseOrderId) ?? 0) +
              Number(cost.amount),
          );
        });

        return orderRows.map((order) => ({
          ...order,
          status: order.status as PurchaseOrderStatus,
          purchaseBillStatus:
            order.purchaseBillStatus as PurchaseOrderListRow["purchaseBillStatus"],
          purchaseBillManualStatus:
            order.purchaseBillManualStatus as PurchaseOrderListRow["purchaseBillManualStatus"],
          xeroPoEmailStatus:
            order.xeroPoEmailStatus as PurchaseOrderListRow["xeroPoEmailStatus"],
          hasAdditionalCosts:
            (additionalCostTotalsByOrderId.get(order.id) ?? 0) > 0,
          additionalCostTotal: (
            additionalCostTotalsByOrderId.get(order.id) ?? 0
          ).toFixed(4),
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
  options?: { includeDeleted?: boolean; accountingProvider?: AccountingProvider },
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
        purchaseBillExternalId: purchaseBillLatestFieldSql<string | null>(
          purchaseOrders.id,
          "sync.external_document_id",
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        purchaseBillExternalNumber: purchaseBillLatestFieldSql<string | null>(
          purchaseOrders.id,
          "sync.external_document_number",
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        purchaseBillManualStatus: purchaseOrders.purchaseBillManualStatus,
        purchaseBillStatus: purchaseBillRollupStatusSql(
          purchaseOrders.id,
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        purchaseBillError: purchaseBillLatestFieldSql<string | null>(
          purchaseOrders.id,
          "sync.push_error",
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        purchaseBillPushedAt: purchaseBillLatestFieldSql<Date | null>(
          purchaseOrders.id,
          "sync.pushed_at",
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        purchaseBillPayloadSnapshot: purchaseBillLatestFieldSql<Record<string, unknown> | null>(
          purchaseOrders.id,
          "sync.push_payload_snapshot",
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
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
          eq(purchaseOrderSyncs.groupKey, "default"),
        ),
      )
      .where(and(...conditions));

    if (!order) {
      return null;
    }

    const [lines, additionalCosts, attachments, taxSettings, accountingGroupStates] = await Promise.all([
      getPurchaseOrderLinesInTx(tx, id),
      getPurchaseOrderAdditionalCostsInTx(tx, id),
      getPurchaseOrderAttachmentsInTx(tx, id),
      getTaxSettingsInTx(tx, orgId),
      getPurchaseOrderAccountingGroupStatesInTx(
        tx,
        id,
        options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
      ),
    ]);
    const landedCosts = calculatePurchaseOrderLandedCosts({
      lines: lines.map((line) => ({
        quantityOrdered: line.quantityOrdered,
        unitCost: line.unitCost,
        purchaseToStockFactor: line.purchaseToStockFactor,
      })),
      additionalCosts,
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
      purchaseBillManualStatus:
        order.purchaseBillManualStatus as PurchaseOrderDetail["purchaseBillManualStatus"],
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
      accountingGroupStates,
      attachments,
    };
  });
}

export async function getEditablePurchaseOrder(
  id: string,
  options?: { accountingProvider?: AccountingProvider },
): Promise<PurchaseOrderEditData | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        supplierId: purchaseOrders.supplierId,
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
        purchaseBillExternalId: purchaseBillLatestFieldSql<string | null>(
          purchaseOrders.id,
          "sync.external_document_id",
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        purchaseBillExternalNumber: purchaseBillLatestFieldSql<string | null>(
          purchaseOrders.id,
          "sync.external_document_number",
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        purchaseBillManualStatus: purchaseOrders.purchaseBillManualStatus,
        purchaseBillStatus: purchaseBillRollupStatusSql(
          purchaseOrders.id,
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        purchaseBillError: purchaseBillLatestFieldSql<string | null>(
          purchaseOrders.id,
          "sync.push_error",
          options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
        ),
        xeroPoEmailStatus: purchaseOrderSyncs.emailStatus,
        xeroPoEmailError: purchaseOrderSyncs.emailError,
        xeroPoEmailedAt: purchaseOrderSyncs.emailedAt,
      })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(
        purchaseOrderSyncs,
        and(
          eq(purchaseOrderSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(purchaseOrderSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_ORDER),
          eq(purchaseOrderSyncs.documentId, purchaseOrders.id),
          eq(purchaseOrderSyncs.groupKey, "default"),
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
          ]),
        ),
      );

    if (!order) {
      return null;
    }

    const [lines, additionalCosts, attachments, taxSettings, accountingGroupStates] = await Promise.all([
      getPurchaseOrderLinesInTx(tx, id),
      getPurchaseOrderAdditionalCostsInTx(tx, id),
      getPurchaseOrderAttachmentsInTx(tx, id),
      getTaxSettingsInTx(tx, orgId),
      getPurchaseOrderAccountingGroupStatesInTx(
        tx,
        id,
        options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO,
      ),
    ]);

    return {
      ...order,
      status: order.status as PurchaseOrderEditData["status"],
      purchaseBillStatus:
        order.purchaseBillStatus as PurchaseOrderEditData["purchaseBillStatus"],
      purchaseBillManualStatus:
        order.purchaseBillManualStatus as PurchaseOrderEditData["purchaseBillManualStatus"],
      xeroPoEmailStatus:
        order.xeroPoEmailStatus as PurchaseOrderEditData["xeroPoEmailStatus"],
      lines: lines.map((line) => ({
        id: line.id,
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
        id: cost.id,
        costType:
          cost.costType as PurchaseOrderEditData["additionalCosts"][number]["costType"],
        reference: cost.reference,
        supplierId: cost.supplierId,
        supplierName: cost.supplierName,
        supplierEmail: cost.supplierEmail,
        distributionMethod:
          cost.distributionMethod as PurchaseOrderEditData["additionalCosts"][number]["distributionMethod"],
        accountingPurchaseAccountCode: cost.accountingPurchaseAccountCode,
        amount: cost.amount,
      })),
      accountingGroupStates,
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
  const orderNumber =
    options.orderNumber ??
    (data.orderNumber == null
      ? await generateOrderNumber(tx, orgId)
      : await resolvePurchaseOrderNumberInTx(tx, orgId, data.orderNumber));

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

function additionalCostOrderNumberCandidate(parentOrderNumber: string, index: number) {
  const suffix = index === 1 ? "-AC" : `-AC${index}`;
  return `${parentOrderNumber.slice(0, 32 - suffix.length)}${suffix}`;
}

async function resolveAdditionalCostOrderNumberInTx(
  tx: Tx,
  orgId: string,
  parentOrderNumber: string,
) {
  for (let index = 1; index < 100; index += 1) {
    const candidate = additionalCostOrderNumberCandidate(parentOrderNumber, index);
    const [existing] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.organizationId, orgId),
          eq(purchaseOrders.orderNumber, candidate),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) return candidate;
  }

  throw new PurchasingError("Unable to assign an additional-cost PO number.", 409);
}

export async function createLinkedAdditionalCostPurchaseOrders(parentOrderId: string) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        supplierId: purchaseOrders.supplierId,
        supplierName: purchaseOrders.supplierName,
        status: purchaseOrders.status,
        expectedDate: purchaseOrders.expectedDate,
        accountingPurchaseAccountCode: purchaseOrders.accountingPurchaseAccountCode,
        shipLine1: purchaseOrders.shipLine1,
        shipLine2: purchaseOrders.shipLine2,
        shipCity: purchaseOrders.shipCity,
        shipRegion: purchaseOrders.shipRegion,
        shipPostcode: purchaseOrders.shipPostcode,
        shipCountry: purchaseOrders.shipCountry,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, parentOrderId),
          eq(purchaseOrders.type, "standard"),
          isNull(purchaseOrders.deletedAt),
          inArray(purchaseOrders.status, ["draft", "ordered"]),
        ),
      )
      .for("update");

    if (!order) return null;

    const [lineRows, costRows] = await Promise.all([
      tx
        .select({ id: purchaseOrderLines.id })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, parentOrderId)),
      tx
        .select({
          id: purchaseOrderAdditionalCosts.id,
          amount: trimScale(purchaseOrderAdditionalCosts.amount).as("amount"),
          supplierId:
            purchaseOrderAdditionalCosts.supplierId,
        })
        .from(purchaseOrderAdditionalCosts)
        .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, parentOrderId)),
    ]);
    const overrideSupplierIds = [
      ...new Set(
        costRows
          .map((cost) => cost.supplierId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const supplierRows =
      overrideSupplierIds.length === 0
        ? []
        : await tx
            .select({
              id: suppliers.id,
              name: suppliers.name,
              email: suppliers.email,
            })
            .from(suppliers)
            .where(
              and(
                inArray(suppliers.id, overrideSupplierIds),
                isNull(suppliers.deletedAt),
              ),
            );
    const suppliersById = new Map(
      supplierRows.map((supplier) => [supplier.id, supplier]),
    );
    const groups = groupPurchaseOrderByResolvedSupplier({
      purchaseOrderSupplier: {
        id: order.supplierId,
        name: order.supplierName,
      },
      suppliersById,
      lines: lineRows,
      additionalCosts: costRows,
    }).filter((group) => !group.isPurchaseOrderSupplier);
    const materialized = [];
    const activeAdditionalCostOrders = await tx
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        supplierId: purchaseOrders.supplierId,
        supplierName: purchaseOrders.supplierName,
        orderedAt: purchaseOrders.orderedAt,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.parentPurchaseOrderId, parentOrderId),
          eq(purchaseOrders.type, "additional_cost"),
          isNull(purchaseOrders.deletedAt),
        ),
      );
    const additionalCostOrderBySupplierId = new Map(
      activeAdditionalCostOrders.map((additionalCostOrder) => [
        additionalCostOrder.supplierId,
        additionalCostOrder,
      ]),
    );
    const activeGroupSupplierIds = new Set(
      groups.map((group) => group.supplier.id),
    );

    for (const group of groups) {
      const amount = normalizeLandedMoney(
        group.additionalCosts.reduce((sum, cost) => sum + Number(cost.amount), 0),
      );
      const existing = additionalCostOrderBySupplierId.get(group.supplier.id);

      if (existing) {
        await tx
          .update(purchaseOrders)
          .set({
            supplierName: group.supplier.name,
            status: order.status,
            expectedDate: order.expectedDate,
            accountingPurchaseAccountCode: order.accountingPurchaseAccountCode,
            shipLine1: order.shipLine1,
            shipLine2: order.shipLine2,
            shipCity: order.shipCity,
            shipRegion: order.shipRegion,
            shipPostcode: order.shipPostcode,
            shipCountry: order.shipCountry,
            shippingCost: amount,
            subtotalAmount: amount,
            taxAmount: "0",
            totalAmount: amount,
            orderedAt: order.status === "ordered"
              ? existing.orderedAt ?? new Date()
              : null,
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, existing.id));
        materialized.push({
          ...existing,
          supplierName: group.supplier.name,
          groupKey: resolvedAdditionalCostSupplierGroupKey(group.supplier.id),
          created: false,
        });
        continue;
      }

      const orderNumber = await resolveAdditionalCostOrderNumberInTx(
        tx,
        orgId,
        order.orderNumber,
      );
      const [created] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId: orgId,
          parentPurchaseOrderId: parentOrderId,
          type: "additional_cost",
          orderNumber,
          supplierId: group.supplier.id,
          supplierName: group.supplier.name,
          status: order.status,
          expectedDate: order.expectedDate,
          notes: `Additional cost for ${order.orderNumber}`,
          accountingPurchaseAccountCode: order.accountingPurchaseAccountCode,
          shipLine1: order.shipLine1,
          shipLine2: order.shipLine2,
          shipCity: order.shipCity,
          shipRegion: order.shipRegion,
          shipPostcode: order.shipPostcode,
          shipCountry: order.shipCountry,
          shippingCost: amount,
          subtotalAmount: amount,
          taxAmount: "0",
          totalAmount: amount,
          orderedAt: ["ordered", "partial", "received"].includes(order.status)
            ? new Date()
            : null,
        })
        .returning({
          id: purchaseOrders.id,
          orderNumber: purchaseOrders.orderNumber,
          supplierId: purchaseOrders.supplierId,
          supplierName: purchaseOrders.supplierName,
        });

      materialized.push({
        ...created,
        groupKey: resolvedAdditionalCostSupplierGroupKey(group.supplier.id),
        created: true,
      });
    }

    const staleAdditionalCostOrderIds = activeAdditionalCostOrders
      .filter((additionalCostOrder) => !activeGroupSupplierIds.has(additionalCostOrder.supplierId))
      .map((additionalCostOrder) => additionalCostOrder.id);
    if (staleAdditionalCostOrderIds.length > 0) {
      await tx
        .update(purchaseOrders)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(purchaseOrders.id, staleAdditionalCostOrderIds));
    }

    return materialized;
  });
}

async function softDeleteLinkedAdditionalCostPurchaseOrdersInTx(
  tx: Tx,
  orgId: string,
  parentOrderIds: string[],
  deletedAt = new Date(),
) {
  const uniqueParentIds = [...new Set(parentOrderIds)].filter(Boolean);
  if (uniqueParentIds.length === 0) return;

  await tx
    .update(purchaseOrders)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(
      and(
        eq(purchaseOrders.organizationId, orgId),
        eq(purchaseOrders.type, "additional_cost"),
        inArray(purchaseOrders.parentPurchaseOrderId, uniqueParentIds),
        isNull(purchaseOrders.deletedAt),
      ),
    );
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
        eq(purchaseOrders.type, "standard"),
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
            eq(purchaseOrders.type, "standard"),
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
  const created = await withAuthedOrgContext((tx, orgId) =>
    createPurchaseOrderInTx(tx, orgId, data),
  );
  const order = await getPurchaseOrder(created.id);
  if (!order) {
    throw new PurchasingError("Purchase order not found after create.", 500);
  }
  return order;
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
      supplierId: cost.supplierId,
      distributionMethod: cost.distributionMethod,
      accountingPurchaseAccountCode: cost.accountingPurchaseAccountCode,
      amount: cost.amount,
    })),
  });
}

function sameNumericValue(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftNumber = Number(left ?? "");
  const rightNumber = Number(right ?? "");
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return (left ?? null) === (right ?? null);
  }
  return Math.abs(leftNumber - rightNumber) < 0.000001;
}

function sameNullableValue(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return (left ?? null) === (right ?? null);
}

export async function updatePurchaseOrder(
  id: string,
  data: UpdatePurchaseOrder,
  options?: { idempotencyKey?: string },
) {
  const updatedId = await withAuthedOrgContext(async (tx, orgId, userId) => {
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
          eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
          eq(accountingDocumentSyncs.documentId, id),
        ),
      );

    if (
      purchaseBillSync?.pushStatus === "pushed" &&
      purchaseBillSync.externalDocumentId
    ) {
      throw new PurchasingError(
        "This purchase order already has an accounting bill. Void it in the accounting provider before editing the purchase order.",
        409,
      );
    }

    const prepared = await preparePurchaseOrderPayload(tx, orgId, data);
    const nextOrderNumber =
      data.orderNumber === undefined || data.orderNumber == null
        ? order.orderNumber
        : await resolvePurchaseOrderNumberInTx(tx, orgId, data.orderNumber, {
            excludeId: id,
          });
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
      const landedCostRevaluationLines: Array<{
        purchaseOrderLineId: string;
        itemId: string;
        unitCost: string;
      }> = [];

      for (const line of prepared.preparedLines) {
        const existingLine = existingLineByItemId.get(line.itemId);
        if (order.status === "received" && !existingLine) {
          throw new PurchasingError(
            "Received purchase order material lines cannot be changed.",
            400,
          );
        }
        if (existingLine) {
          const quantityReceived = parseFloat(existingLine.quantityReceived);
          const stockQuantityReceived = parseFloat(
            existingLine.stockQuantityReceived,
          );
          if (
            order.status === "received" &&
            (!sameNumericValue(line.quantityOrdered, existingLine.quantityOrdered) ||
              !sameNumericValue(
                line.stockQuantityOrdered,
                existingLine.stockQuantityOrdered,
              ) ||
              !sameNumericValue(line.unitCost, existingLine.unitCost) ||
              !sameNullableValue(line.taxRateId, existingLine.taxRateId))
          ) {
            throw new PurchasingError(
              "Received purchase order material lines cannot be changed.",
              400,
            );
          }
          if (
            parseFloat(line.quantityOrdered) < quantityReceived ||
            parseFloat(line.stockQuantityOrdered) < stockQuantityReceived
          ) {
            throw new PurchasingError(
              "Ordered quantity cannot be less than quantity already received.",
              400,
            );
          }
          const previousStockUnitCost = parseFloat(existingLine.stockUnitCost);
          const nextStockUnitCost = parseFloat(line.stockUnitCost);
          if (
            stockQuantityReceived > 0 &&
            Number.isFinite(previousStockUnitCost) &&
            Number.isFinite(nextStockUnitCost) &&
            Math.abs(previousStockUnitCost - nextStockUnitCost) >= 0.000001
          ) {
            landedCostRevaluationLines.push({
              purchaseOrderLineId: existingLine.id,
              itemId: line.itemId,
              unitCost: line.stockUnitCost,
            });
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

      if (landedCostRevaluationLines.length > 0) {
        // The previousStockUnitCost snapshot above and this revaluation are
        // serialized per purchase order by the FOR UPDATE lock taken in
        // getLockedPurchaseOrderInTx at the top of this transaction, so
        // concurrent edits to the same PO cannot double-adjust a lot's cost.
        await revaluePurchaseLandedCostInTx(tx, {
          organizationId: orgId,
          purchaseOrderId: id,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "landed-cost-revaluation",
          ),
          lines: landedCostRevaluationLines,
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
        orderNumber: nextOrderNumber,
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

    return id;
  });

  if (!updatedId) return null;

  const updated = await getPurchaseOrder(updatedId);
  if (!updated) {
    throw new PurchasingError("Purchase order not found after update.", 500);
  }
  return updated;
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
    const { getActiveAccountingProviderForOrg } = await import(
      "@/lib/dal/accounting"
    );
    const active = await getActiveAccountingProviderForOrg(orgId);
    if (active.status === "none") {
      throw new PurchasingError(
        "Connect an accounting provider before creating supplier bills.",
        409,
      );
    }
    if (active.status === "conflict") {
      throw new PurchasingError(
        "Disconnect either Xero or QuickBooks before creating supplier bills.",
        409,
      );
    }

    if (active.provider === "quickbooks") {
      const { createPurchaseBillInQuickBooks, markQuickBooksBillPushFailed } =
        await import("@/lib/accounting/providers/quickbooks/push-bill");
      const { QuickBooksError } = await import(
        "@/lib/accounting/providers/quickbooks/client"
      );
      try {
        const result = await createPurchaseBillInQuickBooks(orgId, id, data);
        return { ok: true as const, result };
      } catch (error) {
        const isExpectedPreflight =
          error instanceof QuickBooksError &&
          (error.status === 404 ||
            error.message.includes("not connected") ||
            error.message.includes("already running"));

        if (!isExpectedPreflight) {
          await markQuickBooksBillPushFailed(orgId, id, error);
        }
        throw error;
      }
    }

    const { createPurchaseBillAccountingSync, markXeroPurchaseBillPushFailed } =
      await import("@/lib/xero/push-purchase-bill");
    const { XeroError } = await import("@/lib/xero/errors");
    try {
      const result = await createPurchaseBillAccountingSync(orgId, id, data);
      return { ok: true as const, result };
    } catch (error) {
      const isExpectedPreflight =
        error instanceof XeroError &&
        (error.status === 404 ||
          error.message.includes("not connected") ||
          error.message.includes("already running"));

      if (!isExpectedPreflight) {
        await markXeroPurchaseBillPushFailed(orgId, id, error);
      }
      throw error;
    }
  });
}

export async function setPurchaseBillManualStatus(
  id: string,
  status: PurchaseOrderListRow["purchaseBillManualStatus"],
) {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .update(purchaseOrders)
      .set({
        purchaseBillManualStatus: status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.type, "standard"),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .returning({
        id: purchaseOrders.id,
        purchaseBillManualStatus: purchaseOrders.purchaseBillManualStatus,
      });

    return order ?? null;
  });
}

export async function receivePurchaseOrder(
  id: string,
  data: ReceivePurchaseOrder,
  options?: { idempotencyKey?: string },
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{
      id: string;
      status: PurchaseOrderStatus;
    } | null>(
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
        type: purchaseOrders.type,
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
    if (order.type === "additional_cost") {
      throw new PurchasingError("Additional-cost purchase orders cannot be received.", 409);
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

    await getValidatedPurchasableItemsInTx(
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

    const result = { id, status: allReceived ? "received" : "partial" };

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

    if (order.type !== "standard") {
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

    const deletedAt = new Date();

    await softDeleteLinkedAdditionalCostPurchaseOrdersInTx(tx, orgId, [id], deletedAt);

    await tx
      .update(purchaseOrders)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(eq(purchaseOrders.id, id));

    return { deleted: true };
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
          eq(purchaseOrders.type, "standard"),
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

    await softDeleteLinkedAdditionalCostPurchaseOrdersInTx(tx, orgId, orderIds, deletedAt);

    const deleted = await tx
      .update(purchaseOrders)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(inArray(purchaseOrders.id, orderIds))
      .returning({ id: purchaseOrders.id });

    return { deletedCount: deleted.length };
  });
}
