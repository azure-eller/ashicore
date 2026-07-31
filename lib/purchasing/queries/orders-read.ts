import "server-only";

import { normalizeNumeric, summarizeItems } from "@/lib/format";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  items,
  itemFamilies,
  accountingClassifications,
  accountingDocumentSyncs,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import { ACCOUNTING_DOCUMENT_PURCHASE_ORDER, ACCOUNTING_DOCUMENT_PURCHASE_BILL, ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/sync-state";
import type { AccountingProvider } from "@/lib/accounting/constants";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { formatItemSnapshotDisplayName } from "@/lib/inventory/display-name";
import { getItemDisplayMetadataByIdInTx } from "@/lib/inventory/item-display";
import { collectPurchaseReceiptRemainderInTx } from "@/lib/inventory/kernel";
import { getTaxSettingsInTx } from "@/lib/dal/tax-settings";
import type { Tx } from "@/lib/db/with-org-context";
import { calculatePurchaseOrderLandedCosts, normalizeLandedMoney, normalizeLandedStockUnitCost } from "@/lib/purchasing/landed-cost";
import { documentNumberSortSql } from "@/lib/document-numbers";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";
import type {
  PurchaseOrderDeleteImpact,
  PurchaseOrderDetail,
  PurchaseOrderDetailLine,
  PurchaseOrderEditData,
  PurchaseOrderListRow,
  PurchaseOrderMaterialOption,
} from "../types";
import { alias } from "drizzle-orm/pg-core";
import { getPurchaseOrderAttachmentsInTx } from "./attachments";
import { getPurchaseOrderAdditionalCostsInTx, getPurchaseOrderLinesInTx } from "./shared";

const purchaseOrderSyncs = alias(accountingDocumentSyncs, "purchase_order_syncs");

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

export async function getPurchaseOrderMaterialOptions(): Promise<
  PurchaseOrderMaterialOption[]
> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: items.id,
        itemType: sql<"material" | "product">`${items.itemType}`,
        name: items.name,
        sku: items.sku,
        supplierItemCode: items.supplierItemCode,
        internalBarcode: items.internalBarcode,
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

    const displayByItemId = await getItemDisplayMetadataByIdInTx(
      tx,
      rows.map((row) => row.id),
    );

    return rows.map((row) => {
      const display = displayByItemId.get(row.id);
      return {
        ...row,
        name: display?.masterName ?? row.name,
        displayName: display?.displayName ?? row.name,
      };
    });
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
            asc(documentNumberSortSql(purchaseOrders.orderNumber, "PO")),
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
              itemId: purchaseOrderLines.itemId,
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

        const displayByItemId = await getItemDisplayMetadataByIdInTx(
          tx,
          lines.map((line) => line.itemId),
        );
        const linesByOrderId = new Map<
          string,
          Array<{ itemName: string; quantity: string }>
        >();
        lines.forEach((line) => {
          const display = displayByItemId.get(line.itemId);
          const bucket = linesByOrderId.get(line.purchaseOrderId) ?? [];
          bucket.push({
            itemName: formatItemSnapshotDisplayName(
              line.itemName,
              display?.optionLabels ?? [],
              [display?.masterName, display?.name],
            ),
            quantity: line.quantity,
          });
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

export async function getPurchaseOrderInTx(
  tx: Tx,
  orgId: string,
  id: string,
  options?: { includeDeleted?: boolean; accountingProvider?: AccountingProvider },
): Promise<PurchaseOrderDetail | null> {
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
        version: purchaseOrders.version,
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
}

export async function getPurchaseOrder(
  id: string,
  options?: { includeDeleted?: boolean; accountingProvider?: AccountingProvider },
): Promise<PurchaseOrderDetail | null> {
  return withAuthedOrgContext((tx, orgId) =>
    getPurchaseOrderInTx(tx, orgId, id, options)
  );
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
        version: purchaseOrders.version,
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
            "not_received",
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
        itemSku: line.itemSku,
        supplierItemCode: line.supplierItemCode,
        internalBarcode: line.internalBarcode,
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

export async function getPurchaseOrderDeleteImpact(
  id: string,
): Promise<PurchaseOrderDeleteImpact | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.type, "standard"),
          isNull(purchaseOrders.deletedAt),
        ),
      );
    if (!order) return null;

    const lineRows = await tx
      .select({
        itemId: purchaseOrderLines.itemId,
        itemName: purchaseOrderLines.itemName,
        stockingUnitName: purchaseOrderLines.stockingUnitName,
        stockQuantityReceived: purchaseOrderLines.stockQuantityReceived,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, id));

    const displayByItemId = await getItemDisplayMetadataByIdInTx(
      tx,
      lineRows.flatMap((line) => (line.itemId ? [line.itemId] : [])),
    );
    const remainder = await collectPurchaseReceiptRemainderInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
    });
    const removeByItemId = new Map<string, number>();
    for (const row of remainder.tracked) {
      removeByItemId.set(
        row.itemId,
        (removeByItemId.get(row.itemId) ?? 0) + row.quantity,
      );
    }
    for (const row of remainder.untracked) {
      removeByItemId.set(
        row.itemId,
        (removeByItemId.get(row.itemId) ?? 0) + row.onHandQty,
      );
    }

    const byItem = new Map<
      string,
      {
        itemId: string;
        itemName: string;
        stockingUnitName: string;
        receivedQty: number;
      }
    >();
    for (const line of lineRows) {
      if (line.itemId == null) continue;
      const receivedQty = parseFloat(line.stockQuantityReceived ?? "0");
      if (receivedQty <= 0) continue;
      const display = displayByItemId.get(line.itemId);
      const current = byItem.get(line.itemId) ?? {
        itemId: line.itemId,
        itemName: formatItemSnapshotDisplayName(
          line.itemName,
          display?.optionLabels ?? [],
          [display?.masterName, display?.name],
        ),
        stockingUnitName: line.stockingUnitName,
        receivedQty: 0,
      };
      current.receivedQty += receivedQty;
      byItem.set(line.itemId, current);
    }

    const impactItems = [...byItem.values()].map((entry) => {
      const removeQty = Math.min(
        removeByItemId.get(entry.itemId) ?? 0,
        entry.receivedQty,
      );
      return {
        ...entry,
        removeQty,
        keptQty: Math.max(0, entry.receivedQty - removeQty),
      };
    });

    const billRows = await tx
      .select({
        pushStatus: accountingDocumentSyncs.pushStatus,
        externalDocumentId: accountingDocumentSyncs.externalDocumentId,
      })
      .from(accountingDocumentSyncs)
      .where(
        and(
          eq(accountingDocumentSyncs.documentId, id),
          eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
        ),
      );
    const billSynced = billRows.some(
      (row) => row.pushStatus === "pushed" || row.externalDocumentId != null,
    );

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      items: impactItems,
      billSynced,
    };
  });
}
