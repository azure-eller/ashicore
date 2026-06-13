import "server-only";

import { normalizeAddressFields } from "@/lib/addresses";
import { normalizeNumeric } from "@/lib/format";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import {
  accountingDocumentSyncs,
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
  persistAccountingDocumentPushSuccess,
} from "@/lib/accounting/sync-state";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getTaxRatesByIdInTx, getTaxSettingsInTx } from "@/lib/dal/tax-settings";
import type { Tx } from "@/lib/db/with-org-context";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  calculatePurchaseOrderLandedCosts,
  normalizeLandedMoney,
  normalizeLandedQuantity,
  normalizeLandedStockUnitCost,
} from "@/lib/purchasing/landed-cost";
import { calculateTaxAmount, calculateTaxedLineTotal } from "@/lib/tax/calc";
import {
  deriveInventoryIdempotencyKey,
  editExpectedFromPurchaseInTx,
  releaseExpectedFromPurchaseInTx,
  revaluePurchaseLandedCostInTx,
} from "@/lib/inventory/kernel";
import { generateShortDocumentNumberInTx } from "@/lib/document-numbers";
import type { InsertPurchaseOrder, UpdatePurchaseOrder } from "@/lib/schemas/purchase-orders";
import { softDeleteLinkedAdditionalCostPurchaseOrdersInTx } from "./additional-costs";
import { PurchasingError } from "./errors";
import { getPurchaseOrder } from "./orders-read";
import { getLockedPurchaseOrderInTx, getPurchaseOrderLinesInTx, getValidatedPurchasableItemsInTx } from "./shared";

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

async function generateOrderNumber(tx: Tx, orgId: string) {
  return generateShortDocumentNumberInTx(tx, "purchase_order", orgId);
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

export async function getValidatedSupplierInTx(tx: Tx, supplierId: string) {
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

function normalizeAdditionalCostInputs(
  payload: PurchaseOrderPayload | UpdatePurchaseOrder,
) {
  return [...(payload.additionalCosts ?? [])];
}

export async function preparePurchaseOrderPayload(
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

      await tx
        .update(accountingDocumentSyncs)
        .set({
          pushStatus: "pending",
          pushError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              accountingDocumentSyncs.documentType,
              ACCOUNTING_DOCUMENT_PURCHASE_BILL,
            ),
            eq(accountingDocumentSyncs.documentId, id),
            isNotNull(accountingDocumentSyncs.externalDocumentId),
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
