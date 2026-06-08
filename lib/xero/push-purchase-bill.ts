import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Invoice, LineAmountTypes, type Invoices, type LineItem } from "xero-node";
import {
  accountingDocumentSyncs,
  integrationExternalRecords,
  organization,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_BILL,
  ACCOUNTING_PROVIDER_XERO,
  markAccountingDocumentPushAttempt,
  persistAccountingDocumentPushFailure,
  persistAccountingDocumentPushSuccess,
  resetAccountingDocumentPushState,
} from "@/lib/accounting/sync-state";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";
import { normalizeNumeric } from "@/lib/format";
import {
  groupPurchaseOrderByResolvedSupplier,
  resolvedPurchaseOrderSupplierGroupKey,
} from "@/lib/purchasing/resolved-supplier-groups";
import type { CreatePurchaseBill } from "@/lib/schemas/purchase-orders";
import { upsertXeroContact, type XeroContactInput } from "./contacts";
import { getAuthedXeroClient } from "./client";
import {
  XeroError,
  extractXeroMessage,
  extractXeroStatusCode,
  redactXeroError,
} from "./errors";
import { buildXeroIdempotencyKey } from "./idempotency";
import { hashXeroPayload } from "./payload-hash";

const PROVIDER_DOCUMENT_TYPE = "xero_accpay_invoice";
const TAX_MODE = LineAmountTypes.Exclusive;
const STALE_PENDING_MS = 10 * 60 * 1000;
const additionalCostSuppliers = alias(
  suppliers,
  "additional_cost_suppliers",
);

type OrderForBill = {
  id: string;
  organizationId: string;
  organizationName: string;
  orderNumber: string;
  status: string;
  supplierId: string;
  supplierName: string;
  accountingPurchaseAccountCode: string | null;
  totalAmount: string;
  xeroBillId: string | null;
  xeroBillNumber: string | null;
  xeroBillStatus: string | null;
  xeroBillPayloadHash: string | null;
  xeroBillLastPushAttemptAt: Date | null;
};

type SupplierForBill = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  xeroContactId: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
};

type LineForBill = {
  id: string;
  itemName: string;
  itemSku: string | null;
  xeroItemCode: string | null;
  purchaseUnitName: string;
  stockingUnitName: string;
  purchaseToStockFactor: string;
  quantityOrdered: string;
  stockQuantityOrdered: string;
  unitCost: string;
  lineTotal: string;
};

type AdditionalCostForBill = {
  id: string;
  costType: string;
  reference: string | null;
  accountingPurchaseAccountCode: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  supplierXeroContactId: string | null;
  supplierBillingLine1: string | null;
  supplierBillingLine2: string | null;
  supplierBillingCity: string | null;
  supplierBillingRegion: string | null;
  supplierBillingPostcode: string | null;
  supplierBillingCountry: string | null;
  amount: string;
};

export type CreatePurchaseBillResult = {
  xeroBillId: string | null;
  xeroBillNumber: string | null;
  status: "pushed";
  created: boolean;
  adopted: boolean;
  bills: Array<{
    groupKey: string;
    xeroBillId: string;
    xeroBillNumber: string;
    created: boolean;
    adopted: boolean;
  }>;
};

function supplierToXeroContact(supplier: SupplierForBill): XeroContactInput {
  return {
    id: supplier.id,
    source: "supplier",
    name: supplier.name,
    email: supplier.email,
    phone: supplier.phone,
    xeroContactId: supplier.xeroContactId,
    billing: {
      line1: supplier.billingLine1,
      line2: supplier.billingLine2,
      city: supplier.billingCity,
      region: supplier.billingRegion,
      postcode: supplier.billingPostcode,
      country: supplier.billingCountry,
    },
    shipping: null,
  };
}

async function loadPurchaseOrderForBillInTx(
  tx: Tx,
  orderId: string,
): Promise<{
  order: OrderForBill;
  supplier: SupplierForBill;
  lines: LineForBill[];
  additionalCosts: AdditionalCostForBill[];
} | null> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      organizationId: purchaseOrders.organizationId,
      organizationName: organization.name,
      orderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: purchaseOrders.supplierName,
      accountingPurchaseAccountCode: purchaseOrders.accountingPurchaseAccountCode,
      totalAmount: purchaseOrders.totalAmount,
    })
    .from(purchaseOrders)
    .innerJoin(organization, eq(purchaseOrders.organizationId, organization.id))
    .where(and(eq(purchaseOrders.id, orderId), isNull(purchaseOrders.deletedAt)))
    .for("update");

  if (!order) return null;

  const [sync] = await tx
    .select({
      xeroBillId: accountingDocumentSyncs.externalDocumentId,
      xeroBillNumber: accountingDocumentSyncs.externalDocumentNumber,
      xeroBillStatus: accountingDocumentSyncs.pushStatus,
      xeroBillPayloadHash: accountingDocumentSyncs.pushPayloadHash,
      xeroBillLastPushAttemptAt: accountingDocumentSyncs.lastPushAttemptAt,
    })
    .from(accountingDocumentSyncs)
    .where(
      and(
        eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
        eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
        eq(accountingDocumentSyncs.documentId, order.id),
        eq(accountingDocumentSyncs.groupKey, "default"),
      ),
    );

  const orderWithSync: OrderForBill = {
    ...order,
    xeroBillId: sync?.xeroBillId ?? null,
    xeroBillNumber: sync?.xeroBillNumber ?? null,
    xeroBillStatus: sync?.xeroBillStatus ?? null,
    xeroBillPayloadHash: sync?.xeroBillPayloadHash ?? null,
    xeroBillLastPushAttemptAt: sync?.xeroBillLastPushAttemptAt ?? null,
  };

  const [supplier] = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      email: suppliers.email,
      phone: suppliers.phone,
      xeroContactId: sql<string | null>`(
        SELECT ${integrationExternalRecords.externalId}
        FROM ${integrationExternalRecords}
        WHERE ${integrationExternalRecords.provider} = ${ACCOUNTING_PROVIDER_XERO}
          AND ${integrationExternalRecords.entityType} = 'supplier'
          AND ${integrationExternalRecords.localRecordId} = ${suppliers.id}
        LIMIT 1
      )`,
      billingLine1: suppliers.billingLine1,
      billingLine2: suppliers.billingLine2,
      billingCity: suppliers.billingCity,
      billingRegion: suppliers.billingRegion,
      billingPostcode: suppliers.billingPostcode,
      billingCountry: suppliers.billingCountry,
    })
    .from(suppliers)
    .where(eq(suppliers.id, order.supplierId));

  if (!supplier) return null;

  const lines = await tx
    .select({
      id: purchaseOrderLines.id,
      itemName: purchaseOrderLines.itemName,
      itemSku: purchaseOrderLines.itemSku,
      xeroItemCode: sql<string | null>`(
        SELECT ${integrationExternalRecords.externalCode}
        FROM ${integrationExternalRecords}
        WHERE ${integrationExternalRecords.provider} = ${ACCOUNTING_PROVIDER_XERO}
          AND ${integrationExternalRecords.entityType} = 'item'
          AND ${integrationExternalRecords.localRecordId} = ${purchaseOrderLines.itemId}
        LIMIT 1
      )`,
      purchaseUnitName: purchaseOrderLines.purchaseUnitName,
      stockingUnitName: purchaseOrderLines.stockingUnitName,
      purchaseToStockFactor: purchaseOrderLines.purchaseToStockFactor,
      quantityOrdered: purchaseOrderLines.quantityOrdered,
      stockQuantityOrdered: purchaseOrderLines.stockQuantityOrdered,
      unitCost: purchaseOrderLines.unitCost,
      lineTotal: purchaseOrderLines.lineSubtotal,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
    .orderBy(purchaseOrderLines.sortOrder);

  const additionalCosts = await tx
    .select({
      id: purchaseOrderAdditionalCosts.id,
      costType: purchaseOrderAdditionalCosts.costType,
      reference: purchaseOrderAdditionalCosts.reference,
      accountingPurchaseAccountCode:
        purchaseOrderAdditionalCosts.accountingPurchaseAccountCode,
      supplierId:
        purchaseOrderAdditionalCosts.supplierId,
      supplierName: additionalCostSuppliers.name,
      supplierEmail: additionalCostSuppliers.email,
      supplierPhone: additionalCostSuppliers.phone,
      supplierXeroContactId: sql<string | null>`(
        SELECT ${integrationExternalRecords.externalId}
        FROM ${integrationExternalRecords}
        WHERE ${integrationExternalRecords.provider} = ${ACCOUNTING_PROVIDER_XERO}
          AND ${integrationExternalRecords.entityType} = 'supplier'
          AND ${integrationExternalRecords.localRecordId} = ${purchaseOrderAdditionalCosts.supplierId}
        LIMIT 1
      )`,
      supplierBillingLine1: additionalCostSuppliers.billingLine1,
      supplierBillingLine2: additionalCostSuppliers.billingLine2,
      supplierBillingCity: additionalCostSuppliers.billingCity,
      supplierBillingRegion: additionalCostSuppliers.billingRegion,
      supplierBillingPostcode:
        additionalCostSuppliers.billingPostcode,
      supplierBillingCountry:
        additionalCostSuppliers.billingCountry,
      amount: purchaseOrderAdditionalCosts.amount,
    })
    .from(purchaseOrderAdditionalCosts)
    .leftJoin(
      additionalCostSuppliers,
      eq(
        additionalCostSuppliers.id,
        purchaseOrderAdditionalCosts.supplierId,
      ),
    )
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId));

  return { order: orderWithSync, supplier, lines, additionalCosts };
}

function conversionSummary(line: LineForBill) {
  if (
    line.purchaseUnitName === line.stockingUnitName ||
    Number(line.purchaseToStockFactor) === 1
  ) {
    return null;
  }

  return `${normalizeNumeric(Number(line.quantityOrdered))} x ${line.purchaseUnitName} = ${normalizeNumeric(Number(line.stockQuantityOrdered))} ${line.stockingUnitName} stock`;
}

function lineDescription(line: LineForBill) {
  const summary = conversionSummary(line);
  return summary ? `${line.itemName} - ${summary}` : line.itemName;
}

function billReference(input: CreatePurchaseBill, order: OrderForBill) {
  return input.reference?.trim() || order.orderNumber;
}

function billCreateOperation(invoiceNumber: string) {
  const digest = createHash("sha256")
    .update(invoiceNumber.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `create-v2:${digest}`;
}

function assertBillablePurchaseOrder(data: {
  order: OrderForBill;
  lines: LineForBill[];
}) {
  if (data.lines.length === 0) {
    throw new XeroError("Add at least one line before creating a Xero bill.", 409);
  }
}

type PurchaseBillGroupInput = CreatePurchaseBill["groups"][number];
type SelectedPurchaseBillGroupInput = PurchaseBillGroupInput & {
  invoiceNumber: string;
  accountingPurchaseAccountCode: string;
};

type PurchaseBillGroupData = {
  key: string;
  supplier: SupplierForBill;
  lines: LineForBill[];
  additionalCosts: AdditionalCostForBill[];
  input: SelectedPurchaseBillGroupInput;
};

function isSelectedPurchaseBillGroupInput(
  group: PurchaseBillGroupInput,
): group is SelectedPurchaseBillGroupInput {
  return (
    group.include !== false &&
    Boolean(group.invoiceNumber?.trim()) &&
    Boolean(group.accountingPurchaseAccountCode?.trim())
  );
}

function supplierFromAdditionalCost(
  cost: AdditionalCostForBill,
  fallback: { id: string; name: string },
): SupplierForBill {
  return {
    id: cost.supplierId ?? fallback.id,
    name: cost.supplierName ?? fallback.name,
    email: cost.supplierEmail,
    phone: cost.supplierPhone,
    xeroContactId: cost.supplierXeroContactId,
    billingLine1: cost.supplierBillingLine1,
    billingLine2: cost.supplierBillingLine2,
    billingCity: cost.supplierBillingCity,
    billingRegion: cost.supplierBillingRegion,
    billingPostcode: cost.supplierBillingPostcode,
    billingCountry: cost.supplierBillingCountry,
  };
}

function buildPurchaseBillGroups(params: {
  data: NonNullable<Awaited<ReturnType<typeof loadPurchaseOrderForBillInTx>>>;
  input: CreatePurchaseBill;
}): PurchaseBillGroupData[] {
  const selectedInputs = new Map(
    params.input.groups
      .filter(isSelectedPurchaseBillGroupInput)
      .map((group) => [group.groupKey, group]),
  );
  const defaultGroupKey = resolvedPurchaseOrderSupplierGroupKey(
    params.data.supplier.id,
  );
  if (selectedInputs.has("default") && !selectedInputs.has(defaultGroupKey)) {
    selectedInputs.set(defaultGroupKey, selectedInputs.get("default")!);
  }

  const suppliersById = new Map(
    params.data.additionalCosts
      .filter((cost) => cost.supplierId)
      .map((cost) => [
        cost.supplierId as string,
        {
          id: cost.supplierId as string,
          name: cost.supplierName ?? "Supplier",
          email: cost.supplierEmail,
        },
      ]),
  );

  return groupPurchaseOrderByResolvedSupplier({
    purchaseOrderSupplier: params.data.supplier,
    suppliersById,
    lines: params.data.lines,
    additionalCosts: params.data.additionalCosts,
  }).flatMap((group) => {
    const groupInput = selectedInputs.get(group.key);
    if (!groupInput) return [];

    const groupInputAdditionalCostIds =
      "additionalCostIds" in groupInput ? groupInput.additionalCostIds : undefined;
    const includedCostIds =
      groupInputAdditionalCostIds == null
        ? null
        : new Set(groupInputAdditionalCostIds);
    const additionalCosts = params.input.legacySingleBillInput
      ? []
      : includedCostIds == null
        ? group.additionalCosts
        : group.additionalCosts.filter((cost) => includedCostIds.has(cost.id));
    if (group.lines.length === 0 && additionalCosts.length === 0) return [];

    const supplier = group.isPurchaseOrderSupplier
      ? params.data.supplier
      : supplierFromAdditionalCost(group.additionalCosts[0], group.supplier);

    return [
      {
        key: group.key,
        supplier,
        lines: group.isPurchaseOrderSupplier ? group.lines : [],
        additionalCosts,
        input: groupInput,
      },
    ];
  });
}

function additionalCostDescription(cost: AdditionalCostForBill) {
  const label =
    cost.costType === "shipping"
      ? "Shipping"
      : cost.costType === "customs"
        ? "Customs"
        : "Additional cost";
  return cost.reference ? `${label} - ${cost.reference}` : label;
}

function buildBillLineItems(params: {
  group: PurchaseBillGroupData;
  defaultAccountCode: string;
  taxType: string | null;
}) {
  const materialLines: LineItem[] = params.group.lines.map((line) => ({
    itemCode: line.xeroItemCode ?? undefined,
    description: lineDescription(line),
    quantity: Number(line.quantityOrdered),
    unitAmount: Number(line.unitCost),
    accountCode: params.defaultAccountCode,
    taxType: params.taxType ?? undefined,
  }));
  const costLines: LineItem[] = params.group.additionalCosts.map((cost) => ({
    description: additionalCostDescription(cost),
    quantity: 1,
    unitAmount: Number(cost.amount),
    accountCode:
      cost.accountingPurchaseAccountCode || params.group.input.accountingPurchaseAccountCode,
    taxType: params.taxType ?? undefined,
  }));

  return [...materialLines, ...costLines];
}

export async function findXeroPurchaseBill(
  orgId: string,
  invoiceNumber: string,
): Promise<{
  invoiceID: string;
  invoiceNumber: string | null;
  contactID: string | null;
  reference: string | null;
  subTotal: number | null;
} | null> {
  const authed = await getAuthedXeroClient(orgId);
  try {
    const response = await authed.client.accountingApi.getInvoices(
      authed.tenantId,
      undefined,
      undefined,
      undefined,
      undefined,
      [invoiceNumber],
    );
    const bill = (response.body.invoices ?? []).find(
      (invoice) =>
        invoice.type === Invoice.TypeEnum.ACCPAY &&
        invoice.invoiceID &&
        invoice.status &&
        ![Invoice.StatusEnum.DELETED, Invoice.StatusEnum.VOIDED].includes(
          invoice.status as Invoice.StatusEnum,
        ),
    );
    return bill?.invoiceID
      ? {
          invoiceID: bill.invoiceID,
          invoiceNumber: bill.invoiceNumber ?? null,
          contactID: bill.contact?.contactID ?? null,
          reference: bill.reference ?? null,
          subTotal:
            bill.subTotal ??
            bill.lineItems?.reduce(
              (sum, line) => sum + (line.lineAmount ?? 0),
              0,
            ) ??
            null,
        }
      : null;
  } catch (error) {
    const status = extractXeroStatusCode(error);
    if (status === 404) return null;

    console.error("Xero purchase bill lookup failed:", redactXeroError(error));
    throw new XeroError(
      `Failed to check existing Xero bills: ${extractXeroMessage(error)}`,
      status ?? 502,
    );
  }
}

async function getXeroPurchaseBillStatusById(
  orgId: string,
  invoiceId: string,
): Promise<Invoice.StatusEnum | "missing"> {
  const authed = await getAuthedXeroClient(orgId);
  try {
    const response = await authed.client.accountingApi.getInvoices(
      authed.tenantId,
      undefined,
      undefined,
      undefined,
      [invoiceId],
    );
    const bill = (response.body.invoices ?? []).find(
      (invoice) =>
        invoice.type === Invoice.TypeEnum.ACCPAY &&
        invoice.invoiceID === invoiceId,
    );
    if (!bill) {
      throw new XeroError(
        "Xero bill status lookup did not return the requested bill.",
        502,
      );
    }
    if (!bill.status) {
      throw new XeroError("Xero bill status lookup returned no status.", 502);
    }
    return bill.status as Invoice.StatusEnum;
  } catch (error) {
    const status = extractXeroStatusCode(error);
    if (status === 404) return "missing";

    console.error("Xero purchase bill status lookup failed:", redactXeroError(error));
    throw new XeroError(
      `Failed to check Xero bill status: ${extractXeroMessage(error)}`,
      status ?? 502,
    );
  }
}

export async function reconcileXeroPurchaseBillExternalState(
  orgId: string,
  orderId: string,
  invoiceId: string,
): Promise<{ reset: boolean; externalStatus: string | null }> {
  const status = await getXeroPurchaseBillStatusById(orgId, invoiceId);
  const shouldReset =
    status === "missing" ||
    status === Invoice.StatusEnum.DELETED ||
    status === Invoice.StatusEnum.VOIDED;

  if (!shouldReset) {
    return { reset: false, externalStatus: String(status) };
  }

  await withOrgContext(orgId, async (tx) => {
    const [sync] = await tx
      .select({ groupKey: accountingDocumentSyncs.groupKey })
      .from(accountingDocumentSyncs)
      .where(
        and(
          eq(accountingDocumentSyncs.organizationId, orgId),
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
          eq(accountingDocumentSyncs.documentId, orderId),
          eq(accountingDocumentSyncs.externalDocumentId, invoiceId),
        ),
      )
      .limit(1);
    await resetAccountingDocumentPushState(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
      documentId: orderId,
      groupKey: sync?.groupKey,
    });
  });

  await tryRecordAccountingAuditEvent({
    organizationId: orgId,
    actor: { type: "process", processName: "xero_retry_cron" },
    eventType: "xero_retry",
    outcome: "success",
    source: "lib/xero/push-purchase-bill:reconcileXeroPurchaseBillExternalState",
    provider: ACCOUNTING_PROVIDER_XERO,
    localEntityType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
    localEntityId: orderId,
    metadata: {
      externalBillId: invoiceId,
      externalStatus: status,
      action: "reset_to_not_billed",
    },
  });

  return { reset: true, externalStatus: String(status) };
}

export async function createPurchaseBillAccountingSync(
  orgId: string,
  orderId: string,
  input: CreatePurchaseBill,
): Promise<CreatePurchaseBillResult> {
  await withOrgContext(orgId, async (tx) => {
    const loaded = await loadPurchaseOrderForBillInTx(tx, orderId);
    if (!loaded) {
      throw new XeroError("Purchase order not found.", 404);
    }
    assertBillablePurchaseOrder(loaded);
    if (
      input.legacySingleBillInput &&
      loaded.additionalCosts.length > 0 &&
      input.confirmAdditionalCostsOmitted !== true
    ) {
      throw new XeroError(
        "Confirm that additional costs will be added manually in Xero.",
        400,
      );
    }

    const groups = buildPurchaseBillGroups({ data: loaded, input });
    if (groups.length === 0) {
      throw new XeroError("Select at least one bill group to create.", 400);
    }
    const syncRows = await tx
      .select({
        groupKey: accountingDocumentSyncs.groupKey,
        pushStatus: accountingDocumentSyncs.pushStatus,
        lastPushAttemptAt: accountingDocumentSyncs.lastPushAttemptAt,
      })
      .from(accountingDocumentSyncs)
      .where(
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(
            accountingDocumentSyncs.documentType,
            ACCOUNTING_DOCUMENT_PURCHASE_BILL,
          ),
          eq(accountingDocumentSyncs.documentId, orderId),
          inArray(
            accountingDocumentSyncs.groupKey,
            [...new Set(["default", ...groups.map((group) => group.key)])],
          ),
        ),
      );
    for (const sync of syncRows) {
      if (
        sync.pushStatus === "pending" &&
        (!sync.lastPushAttemptAt ||
          Date.now() - sync.lastPushAttemptAt.getTime() < STALE_PENDING_MS)
      ) {
        throw new XeroError("Xero bill sync is already running.", 409);
      }
    }
  });

  const authed = await getAuthedXeroClient(orgId);
  const connection = authed.connection;
  const accountingApi = authed.client.accountingApi;
  const taxType = connection.purchaseOrderDefaultTaxType ?? connection.defaultTaxType;

  const prepared = await withOrgContext(orgId, async (tx) => {
    const loaded = await loadPurchaseOrderForBillInTx(tx, orderId);
    if (!loaded) return null;
    assertBillablePurchaseOrder(loaded);
    const groups = buildPurchaseBillGroups({ data: loaded, input });
    if (groups.length === 0) {
      throw new XeroError("Select at least one bill group to create.", 400);
    }

    const syncRows = await tx
      .select({
        groupKey: accountingDocumentSyncs.groupKey,
        externalDocumentId: accountingDocumentSyncs.externalDocumentId,
        externalDocumentNumber: accountingDocumentSyncs.externalDocumentNumber,
        pushStatus: accountingDocumentSyncs.pushStatus,
        lastPushAttemptAt: accountingDocumentSyncs.lastPushAttemptAt,
      })
      .from(accountingDocumentSyncs)
      .where(
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(
            accountingDocumentSyncs.documentType,
            ACCOUNTING_DOCUMENT_PURCHASE_BILL,
          ),
          eq(accountingDocumentSyncs.documentId, orderId),
          inArray(
            accountingDocumentSyncs.groupKey,
            [...new Set(["default", ...groups.map((group) => group.key)])],
          ),
        ),
      );
    const syncByGroup = new Map(syncRows.map((row) => [row.groupKey, row]));

    const readyGroups = [];
    const alreadyPushed = [];
    for (const group of groups) {
      const sync = syncByGroup.get(group.key) ?? (
        group.key === resolvedPurchaseOrderSupplierGroupKey(loaded.supplier.id)
          ? syncByGroup.get("default")
          : undefined
      );
      if (
        sync?.pushStatus === "pending" &&
        (!sync.lastPushAttemptAt ||
          Date.now() - sync.lastPushAttemptAt.getTime() < STALE_PENDING_MS)
      ) {
        throw new XeroError("Xero bill sync is already running.", 409);
      }
      if (sync?.pushStatus === "pushed" && sync.externalDocumentId) {
        if (
          !sync.externalDocumentNumber ||
          sync.externalDocumentNumber !== group.input.invoiceNumber
        ) {
          throw new XeroError(
            "This purchase order group already has a Xero bill. Void it in Xero before recreating.",
            409,
          );
        }
        alreadyPushed.push({
          group,
          xeroBillId: sync.externalDocumentId,
          xeroBillNumber: sync.externalDocumentNumber,
        });
        continue;
      }

      const lineItems = buildBillLineItems({
        group,
        defaultAccountCode: group.input.accountingPurchaseAccountCode,
        taxType,
      });
      const snapshot = {
        invoiceNumber: group.input.invoiceNumber,
        billDate: input.billDate,
        dueDate: input.dueDate,
        reference: billReference(input, loaded.order),
        groupKey: group.key,
        supplier: { id: group.supplier.id, name: group.supplier.name },
        purchaseOrder: {
          id: loaded.order.id,
          orderNumber: loaded.order.orderNumber,
          status: loaded.order.status,
        },
        lineAmountTypes: TAX_MODE,
        taxMode: "exclusive",
        taxType,
        defaultAccountCode: group.input.accountingPurchaseAccountCode,
        lineItems: lineItems.map((line) => ({
          itemCode: line.itemCode ?? null,
          description: line.description ?? null,
          quantity: line.quantity ?? null,
          unitAmount: line.unitAmount ?? null,
          lineAmount: line.lineAmount ?? null,
          accountCode: line.accountCode ?? null,
          taxType: line.taxType ?? null,
        })),
        includedAdditionalCostIds: group.additionalCosts.map((cost) => cost.id),
      };
      const payloadHash = hashXeroPayload(snapshot);
      const idempotencyKey = buildXeroIdempotencyKey(
        orgId,
        "purchase-bill",
        orderId,
        `${group.key}:${billCreateOperation(group.input.invoiceNumber)}`,
      );

      await markAccountingDocumentPushAttempt(tx, {
        organizationId: orgId,
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
        documentId: orderId,
        groupKey: group.key,
        pushStatus: "pending",
        providerDocumentType: PROVIDER_DOCUMENT_TYPE,
        idempotencyKey,
      });
      readyGroups.push({
        group,
        lineItems,
        snapshot,
        payloadHash,
        idempotencyKey,
      });
    }

    return {
      status: "ready" as const,
      data: loaded,
      readyGroups,
      alreadyPushed,
    };
  });

  if (!prepared) {
    throw new XeroError("Purchase order not found.", 404);
  }

  const reference = billReference(input, prepared.data.order);
  const bills: CreatePurchaseBillResult["bills"] = prepared.alreadyPushed.map(
    (row) => ({
      groupKey: row.group.key,
      xeroBillId: row.xeroBillId,
      xeroBillNumber: row.xeroBillNumber,
      created: false,
      adopted: false,
    }),
  );
  const successfulReadyGroups: Array<{
    ready: (typeof prepared.readyGroups)[number];
    billId: string;
    billNumber: string;
    created: boolean;
    adopted: boolean;
  }> = [];
  const billsToCreate: Array<{
    ready: (typeof prepared.readyGroups)[number];
    bill: Invoice;
  }> = [];

  for (const ready of prepared.readyGroups) {
    const expectedSubTotal = ready.lineItems.reduce(
      (sum, line) =>
        sum +
        (line.lineAmount ??
          Number(line.quantity ?? 0) * Number(line.unitAmount ?? 0)),
      0,
    );
    const contactId = await upsertXeroContact(
      orgId,
      supplierToXeroContact(ready.group.supplier),
      authed.tenantId,
      accountingApi,
    );
    const existing = await findXeroPurchaseBill(
      orgId,
      ready.group.input.invoiceNumber,
    );
    if (existing) {
      const contactMatches = existing.contactID === contactId;
      const referenceMatches = existing.reference === reference;
      const subtotalMatches =
        existing.subTotal != null &&
        Math.abs(existing.subTotal - expectedSubTotal) < 0.01;

      if (!contactMatches || !referenceMatches || !subtotalMatches) {
        throw new XeroError(
          "A Xero bill already exists with this supplier invoice number, but it does not match this purchase order.",
          409,
        );
      }

      successfulReadyGroups.push({
        ready,
        billId: existing.invoiceID,
        billNumber: existing.invoiceNumber ?? ready.group.input.invoiceNumber,
        created: false,
        adopted: true,
      });
    } else {
      billsToCreate.push({
        ready,
        bill: {
          type: Invoice.TypeEnum.ACCPAY,
          contact: { contactID: contactId },
          lineItems: ready.lineItems,
          lineAmountTypes: TAX_MODE,
          date: input.billDate,
          dueDate: input.dueDate,
          invoiceNumber: ready.group.input.invoiceNumber,
          reference,
          status: Invoice.StatusEnum.DRAFT,
        },
      });
    }
  }

  if (billsToCreate.length > 0) {
    const batchIdempotencyKey = buildXeroIdempotencyKey(
      orgId,
      "purchase-bill",
      orderId,
      `create-batch-v2:${createHash("sha256")
        .update(
          billsToCreate
            .map((entry) => entry.ready.group.input.invoiceNumber)
            .join("\n"),
        )
        .digest("hex")
        .slice(0, 32)}`,
    );

    try {
      const response = await accountingApi.createInvoices(
        authed.tenantId,
        { invoices: billsToCreate.map((entry) => entry.bill) } satisfies Invoices,
        undefined,
        undefined,
        batchIdempotencyKey,
      );
      const returnedByInvoiceNumber = new Map(
        (response.body.invoices ?? [])
          .filter((invoice) => invoice.invoiceID)
          .map((invoice) => [invoice.invoiceNumber, invoice]),
      );

      for (const entry of billsToCreate) {
        const returned = returnedByInvoiceNumber.get(
          entry.ready.group.input.invoiceNumber,
        );
        if (!returned?.invoiceID) {
          throw new XeroError("Xero did not return every bill ID.", 502);
        }
        successfulReadyGroups.push({
          ready: entry.ready,
          billId: returned.invoiceID,
          billNumber:
            returned.invoiceNumber ?? entry.ready.group.input.invoiceNumber,
          created: true,
          adopted: false,
        });
      }
    } catch (error) {
      if (error instanceof XeroError) throw error;
      const status = extractXeroStatusCode(error);
      console.error("Xero purchase bill create failed:", redactXeroError(error));
      throw new XeroError(
        `Failed to create Xero bill: ${extractXeroMessage(error)}`,
        status ?? 502,
      );
    }
  }

  await withOrgContext(orgId, async (tx) => {
    for (const success of successfulReadyGroups) {
      await persistAccountingDocumentPushSuccess(tx, {
        organizationId: orgId,
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
        documentId: orderId,
        groupKey: success.ready.group.key,
        externalDocumentId: success.billId,
        externalDocumentNumber: success.billNumber,
        payloadHash: success.ready.payloadHash,
        providerDocumentType: PROVIDER_DOCUMENT_TYPE,
        idempotencyKey: success.ready.idempotencyKey,
        payloadSnapshot: success.ready.snapshot,
      });
    }
  });

  for (const success of successfulReadyGroups) {
    bills.push({
      groupKey: success.ready.group.key,
      xeroBillId: success.billId,
      xeroBillNumber: success.billNumber,
      created: success.created,
      adopted: success.adopted,
    });
  }

  await tryRecordAccountingAuditEvent({
    organizationId: orgId,
    actor: { type: "process", processName: "xero_push" },
    eventType: "xero_push",
    outcome: "success",
    source: "lib/xero/push-purchase-bill:createPurchaseBillAccountingSync",
    tenantId: authed.tenantId,
    tenantName: authed.tenantName,
    provider: ACCOUNTING_PROVIDER_XERO,
    localEntityType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
    localEntityId: orderId,
    metadata: {
      bills,
    },
  });

  const firstBill = bills[0] ?? null;
  return {
    xeroBillId: firstBill?.xeroBillId ?? null,
    xeroBillNumber: firstBill?.xeroBillNumber ?? null,
    status: "pushed",
    created: bills.some((bill) => bill.created),
    adopted: bills.some((bill) => bill.adopted),
    bills,
  };
}

export async function markXeroPurchaseBillPushFailed(
  orgId: string,
  orderId: string,
  error: unknown,
) {
  const message = extractXeroMessage(error).slice(0, 500);
  await withOrgContext(orgId, async (tx) => {
    const pendingRows = await tx
      .select({ groupKey: accountingDocumentSyncs.groupKey })
      .from(accountingDocumentSyncs)
      .where(
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(
            accountingDocumentSyncs.documentType,
            ACCOUNTING_DOCUMENT_PURCHASE_BILL,
          ),
          eq(accountingDocumentSyncs.documentId, orderId),
          eq(accountingDocumentSyncs.pushStatus, "pending"),
        ),
      );
    for (const groupKey of pendingRows.map((row) => row.groupKey)) {
      await persistAccountingDocumentPushFailure(tx, {
        organizationId: orgId,
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
        documentId: orderId,
        groupKey,
        error: message,
        providerDocumentType: PROVIDER_DOCUMENT_TYPE,
      });
    }
  });
  await tryRecordAccountingAuditEvent({
    organizationId: orgId,
    actor: { type: "process", processName: "xero_push" },
    eventType: "xero_push",
    outcome: "failure",
    source: "lib/xero/push-purchase-bill:markXeroPurchaseBillPushFailed",
    provider: ACCOUNTING_PROVIDER_XERO,
    localEntityType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
    localEntityId: orderId,
    metadata: accountingAuditErrorMetadata(error),
  });
}
