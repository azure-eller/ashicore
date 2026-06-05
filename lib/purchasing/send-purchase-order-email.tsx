import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  accountingDocumentSyncs,
  attachmentFiles,
  organization,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
  ACCOUNTING_PROVIDER_XERO,
  ATTACHMENT_OWNER_PURCHASE_ORDER,
  persistAccountingDocumentEmailOutcome,
} from "@/lib/accounting/sync-state";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";
import { sendTransactionalEmail } from "@/lib/email/send";
import { formatEmailFromDisplayName } from "@/lib/email/config";
import { getPrivateBlobForDownload } from "@/lib/blob-storage";
import {
  isLocalAttachmentUrl,
  readLocalAttachment,
} from "@/lib/attachments/local-file-storage";
import {
  PurchaseOrderDocument,
  type PurchaseOrderPdf,
  type PurchaseOrderPdfAdditionalCost,
  type PurchaseOrderPdfLine,
} from "@/lib/pdf/purchase-order-document";
import { escapeHtml } from "@/lib/format";
import type { SendPurchaseOrderEmail } from "@/lib/schemas/purchase-orders";
import { DomainError } from "@/lib/errors/domain-error";
import { groupPurchaseOrderByResolvedVendor } from "@/lib/purchasing/resolved-vendor-groups";

const additionalCostVendorSuppliers = alias(
  suppliers,
  "email_additional_cost_vendor_suppliers",
);

type PurchaseOrderEmailData = {
  order: PurchaseOrderPdf & {
    id: string;
    supplierId: string;
    status: string;
    supplierEmail: string | null;
  };
  organizationName: string;
  lines: (PurchaseOrderPdfLine & { id: string })[];
  additionalCosts: (PurchaseOrderPdfAdditionalCost & {
    id: string;
    vendorOverrideSupplierId: string | null;
    vendorOverrideSupplierName: string | null;
    vendorOverrideSupplierEmail: string | null;
    vendorOverrideSupplierContactName: string | null;
    vendorOverrideSupplierPhone: string | null;
    vendorOverrideSupplierBillingLine1: string | null;
    vendorOverrideSupplierBillingLine2: string | null;
    vendorOverrideSupplierBillingCity: string | null;
    vendorOverrideSupplierBillingRegion: string | null;
    vendorOverrideSupplierBillingPostcode: string | null;
    vendorOverrideSupplierBillingCountry: string | null;
  })[];
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    blobUrl: string;
  }[];
  emailStates: {
    groupKey: string;
    emailStatus: string | null;
  }[];
};

async function loadPurchaseOrderEmailDataInTx(
  tx: Tx,
  orderId: string,
): Promise<PurchaseOrderEmailData | null> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      supplierId: purchaseOrders.supplierId,
      organizationName: organization.name,
      orderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
      supplierName: purchaseOrders.supplierName,
      supplierContactName: suppliers.contactName,
      supplierEmail: suppliers.email,
      supplierPhone: suppliers.phone,
      supplierBillingLine1: suppliers.billingLine1,
      supplierBillingLine2: suppliers.billingLine2,
      supplierBillingCity: suppliers.billingCity,
      supplierBillingRegion: suppliers.billingRegion,
      supplierBillingPostcode: suppliers.billingPostcode,
      supplierBillingCountry: suppliers.billingCountry,
      expectedDate: purchaseOrders.expectedDate,
      orderedAt: purchaseOrders.orderedAt,
      deliveryInstructions: purchaseOrders.notes,
      shipContactName: sql<string | null>`NULL`,
      shipContactPhone: sql<string | null>`NULL`,
      shipLine1: purchaseOrders.shipLine1,
      shipLine2: purchaseOrders.shipLine2,
      shipCity: purchaseOrders.shipCity,
      shipRegion: purchaseOrders.shipRegion,
      shipPostcode: purchaseOrders.shipPostcode,
      shipCountry: purchaseOrders.shipCountry,
      subtotalAmount: purchaseOrders.subtotalAmount,
      taxAmount: purchaseOrders.taxAmount,
      totalAmount: purchaseOrders.totalAmount,
    })
    .from(purchaseOrders)
    .innerJoin(organization, eq(purchaseOrders.organizationId, organization.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(and(eq(purchaseOrders.id, orderId), isNull(purchaseOrders.deletedAt)));

  if (!order) return null;

  const lines = await tx
    .select({
      id: purchaseOrderLines.id,
      itemName: purchaseOrderLines.itemName,
      itemSku: purchaseOrderLines.itemSku,
      purchaseUnitName: purchaseOrderLines.purchaseUnitName,
      quantityOrdered: purchaseOrderLines.quantityOrdered,
      unitCost: purchaseOrderLines.unitCost,
      taxRatePercent: purchaseOrderLines.taxRatePercent,
      lineTotal: purchaseOrderLines.lineSubtotal,
      shipContactName: purchaseOrderLines.shipContactName,
      shipContactPhone: purchaseOrderLines.shipContactPhone,
      shipLine1: purchaseOrderLines.shipLine1,
      shipLine2: purchaseOrderLines.shipLine2,
      shipCity: purchaseOrderLines.shipCity,
      shipRegion: purchaseOrderLines.shipRegion,
      shipPostcode: purchaseOrderLines.shipPostcode,
      shipCountry: purchaseOrderLines.shipCountry,
      shipDeliveryInstructions: purchaseOrderLines.shipDeliveryInstructions,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
    .orderBy(purchaseOrderLines.sortOrder);
  const deliveryLine = lines.find(
    (line) =>
      line.shipContactName ||
      line.shipContactPhone ||
      line.shipLine1 ||
      line.shipLine2 ||
      line.shipCity ||
      line.shipRegion ||
      line.shipPostcode ||
      line.shipCountry ||
      line.shipDeliveryInstructions,
  );
  const attachments = await tx
    .select({
      id: attachmentFiles.id,
      filename: attachmentFiles.filename,
      contentType: attachmentFiles.contentType,
      blobUrl: attachmentFiles.blobUrl,
    })
    .from(attachmentFiles)
    .where(
      and(
        eq(attachmentFiles.ownerType, ATTACHMENT_OWNER_PURCHASE_ORDER),
        eq(attachmentFiles.ownerId, orderId),
        isNull(attachmentFiles.deletedAt),
      ),
    );
  const additionalCosts = await tx
    .select({
      id: purchaseOrderAdditionalCosts.id,
      costType: purchaseOrderAdditionalCosts.costType,
      reference: purchaseOrderAdditionalCosts.reference,
      amount: purchaseOrderAdditionalCosts.amount,
      vendorOverrideSupplierId:
        purchaseOrderAdditionalCosts.vendorOverrideSupplierId,
      vendorOverrideSupplierName: additionalCostVendorSuppliers.name,
      vendorOverrideSupplierEmail: additionalCostVendorSuppliers.email,
      vendorOverrideSupplierContactName: additionalCostVendorSuppliers.contactName,
      vendorOverrideSupplierPhone: additionalCostVendorSuppliers.phone,
      vendorOverrideSupplierBillingLine1:
        additionalCostVendorSuppliers.billingLine1,
      vendorOverrideSupplierBillingLine2:
        additionalCostVendorSuppliers.billingLine2,
      vendorOverrideSupplierBillingCity:
        additionalCostVendorSuppliers.billingCity,
      vendorOverrideSupplierBillingRegion:
        additionalCostVendorSuppliers.billingRegion,
      vendorOverrideSupplierBillingPostcode:
        additionalCostVendorSuppliers.billingPostcode,
      vendorOverrideSupplierBillingCountry:
        additionalCostVendorSuppliers.billingCountry,
    })
    .from(purchaseOrderAdditionalCosts)
    .leftJoin(
      additionalCostVendorSuppliers,
      eq(
        additionalCostVendorSuppliers.id,
        purchaseOrderAdditionalCosts.vendorOverrideSupplierId,
      ),
    )
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId))
    .orderBy(purchaseOrderAdditionalCosts.sortOrder);
  const emailStates = await tx
    .select({
      groupKey: accountingDocumentSyncs.groupKey,
      emailStatus: accountingDocumentSyncs.emailStatus,
    })
    .from(accountingDocumentSyncs)
    .where(
      and(
        eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_ORDER),
        eq(accountingDocumentSyncs.documentId, orderId),
        eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
      ),
    );

  return {
    organizationName: order.organizationName,
    order: {
      ...order,
      deliveryInstructions:
        order.deliveryInstructions,
      shipContactName: deliveryLine?.shipContactName ?? null,
      shipContactPhone: deliveryLine?.shipContactPhone ?? null,
      shipLine1: order.shipLine1 ?? deliveryLine?.shipLine1 ?? null,
      shipLine2: order.shipLine2 ?? deliveryLine?.shipLine2 ?? null,
      shipCity: order.shipCity ?? deliveryLine?.shipCity ?? null,
      shipRegion: order.shipRegion ?? deliveryLine?.shipRegion ?? null,
      shipPostcode: order.shipPostcode ?? deliveryLine?.shipPostcode ?? null,
      shipCountry: order.shipCountry ?? deliveryLine?.shipCountry ?? null,
    },
    lines: lines.map((line) => ({
      id: line.id,
      itemName: line.itemName,
      itemSku: line.itemSku,
      purchaseUnitName: line.purchaseUnitName,
      quantityOrdered: line.quantityOrdered,
      unitCost: line.unitCost,
      taxRatePercent: line.taxRatePercent,
      lineTotal: line.lineTotal,
    })),
    additionalCosts: additionalCosts
      .filter((cost) => Number(cost.amount) !== 0)
      .map((cost) => ({
        costType: cost.costType,
        reference: cost.reference,
        amount: cost.amount,
        id: cost.id,
        vendorOverrideSupplierId: cost.vendorOverrideSupplierId,
        vendorOverrideSupplierName: cost.vendorOverrideSupplierName,
        vendorOverrideSupplierEmail: cost.vendorOverrideSupplierEmail,
        vendorOverrideSupplierContactName: cost.vendorOverrideSupplierContactName,
        vendorOverrideSupplierPhone: cost.vendorOverrideSupplierPhone,
        vendorOverrideSupplierBillingLine1:
          cost.vendorOverrideSupplierBillingLine1,
        vendorOverrideSupplierBillingLine2:
          cost.vendorOverrideSupplierBillingLine2,
        vendorOverrideSupplierBillingCity:
          cost.vendorOverrideSupplierBillingCity,
        vendorOverrideSupplierBillingRegion:
          cost.vendorOverrideSupplierBillingRegion,
        vendorOverrideSupplierBillingPostcode:
          cost.vendorOverrideSupplierBillingPostcode,
        vendorOverrideSupplierBillingCountry:
          cost.vendorOverrideSupplierBillingCountry,
    })),
    attachments,
    emailStates,
  };
}

function sanitizePdfFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
}

function moneySum(values: Array<{ amount: string }>) {
  return values.reduce((sum, value) => sum + Number(value.amount), 0).toFixed(4);
}

function buildEmailGroups(data: PurchaseOrderEmailData) {
  const supplierRows = data.additionalCosts
    .filter((cost) => cost.vendorOverrideSupplierId)
    .map((cost) => ({
      id: cost.vendorOverrideSupplierId as string,
      name: cost.vendorOverrideSupplierName ?? "Vendor",
      email: cost.vendorOverrideSupplierEmail,
    }));
  const suppliersById = new Map(supplierRows.map((supplier) => [supplier.id, supplier]));

  return groupPurchaseOrderByResolvedVendor({
    purchaseOrderSupplier: {
      id: data.order.supplierId,
      name: data.order.supplierName,
      email: data.order.supplierEmail,
    },
    suppliersById,
    lines: data.lines,
    additionalCosts: data.additionalCosts,
  }).map((group) => {
    const firstCost = group.additionalCosts[0];
    const freightTotal = moneySum(group.additionalCosts);
    const order: PurchaseOrderPdf = group.isPurchaseOrderSupplier
      ? data.order
      : {
          ...data.order,
          supplierName: group.supplier.name,
          supplierContactName:
            firstCost?.vendorOverrideSupplierContactName ?? null,
          supplierEmail: group.supplier.email ?? null,
          supplierPhone: firstCost?.vendorOverrideSupplierPhone ?? null,
          supplierBillingLine1:
            firstCost?.vendorOverrideSupplierBillingLine1 ?? null,
          supplierBillingLine2:
            firstCost?.vendorOverrideSupplierBillingLine2 ?? null,
          supplierBillingCity:
            firstCost?.vendorOverrideSupplierBillingCity ?? null,
          supplierBillingRegion:
            firstCost?.vendorOverrideSupplierBillingRegion ?? null,
          supplierBillingPostcode:
            firstCost?.vendorOverrideSupplierBillingPostcode ?? null,
          supplierBillingCountry:
            firstCost?.vendorOverrideSupplierBillingCountry ?? null,
          subtotalAmount: freightTotal,
          taxAmount: "0",
          totalAmount: freightTotal,
        };

    return {
      key: group.key,
      order,
      supplier: group.supplier,
      isFreight: !group.isPurchaseOrderSupplier,
      lines: group.isPurchaseOrderSupplier ? group.lines : [],
      additionalCosts: group.additionalCosts,
    };
  });
}

async function attachmentContentBase64(blobUrl: string) {
  if (isLocalAttachmentUrl(blobUrl)) {
    const buffer = await readLocalAttachment(blobUrl);
    return buffer?.toString("base64") ?? null;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  const blob = await getPrivateBlobForDownload(blobUrl);
  if (!blob?.stream) return null;
  const arrayBuffer = await new Response(blob.stream).arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

async function persistPurchaseOrderEmailOutcome(
  orgId: string,
  orderId: string,
  outcome:
    | { status: "sent"; error?: never }
    | { status: "failed"; error: string }
    | { status: "skipped"; error?: never },
  groupKey = "default",
) {
  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentEmailOutcome(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
      documentId: orderId,
      groupKey,
      outcome,
    });
  });
}

export async function renderPurchaseOrderPdfBuffer(
  orgId: string,
  orderId: string,
  groupKey?: string | null,
) {
  const data = await withOrgContext(orgId, async (tx) =>
    loadPurchaseOrderEmailDataInTx(tx, orderId),
  );
  if (!data) return null;
  const groups = buildEmailGroups(data);
  const resolvedGroupKey =
    !groupKey || groupKey === "default" ? groups[0]?.key : groupKey;
  const group = resolvedGroupKey
    ? groups.find((candidate) => candidate.key === resolvedGroupKey)
    : null;
  if (!group) return null;

  const buffer = await renderToBuffer(
    <PurchaseOrderDocument
      order={group.order}
      lines={group.lines}
      additionalCosts={group.additionalCosts}
      organizationName={data.organizationName}
      variant={group.isFreight ? "freight" : "standard"}
    />,
  );
  const safeOrderNumber =
    sanitizePdfFileSegment(data.order.orderNumber) || "purchase-order";
  const fileSuffix = group.isFreight
    ? `-${sanitizePdfFileSegment(group.supplier.name) || "freight"}`
    : "";

  return {
    orderNumber: `${safeOrderNumber}${fileSuffix}`,
    buffer,
  };
}

export async function sendPurchaseOrderEmail(params: {
  orgId: string;
  orderId: string;
  actorUserId: string;
  idempotencyKey: string;
  input: SendPurchaseOrderEmail;
}): Promise<{ status: "sent"; sent: Array<{ groupKey: string; recipientEmail: string }> }> {
  const data = await withOrgContext(params.orgId, async (tx) =>
    loadPurchaseOrderEmailDataInTx(tx, params.orderId),
  );
  if (!data) {
    throw new DomainError("Purchase order not found.", 404);
  }
  if (data.order.status === "cancelled") {
    throw new DomainError("Cancelled purchase orders cannot be emailed.", 409);
  }
  let currentGroupKey: string | null = null;
  let firstSelectedGroupKey: string | null = null;
  try {
    const groups = buildEmailGroups(data);
    const groupsByKey = new Map(groups.map((group) => [group.key, group]));
    const sentGroupKeys = new Set(
      data.emailStates
        .filter((state) => state.emailStatus === "sent")
        .map((state) => state.groupKey),
    );
    const selectedInputs = params.input.groups.filter(
      (group) => group.include !== false,
    );
    firstSelectedGroupKey = selectedInputs[0]?.groupKey ?? null;
    const selectedAttachmentFileIds = new Set(
      selectedInputs.flatMap((input) => input.attachmentFileIds ?? []),
    );

    const uploadedAttachments = (
      await Promise.all(
        data.attachments
          .filter((file) => selectedAttachmentFileIds.has(file.id))
          .map(async (file) => {
          const content = await attachmentContentBase64(file.blobUrl);
          if (!content) {
            throw new DomainError(`Attachment "${file.filename}" could not be read.`, 503);
          }
          return {
            id: file.id,
            filename: file.filename,
            contentType: file.contentType,
            content,
          };
          }),
      )
    ).filter((file): file is { id: string; filename: string; contentType: string; content: string } =>
      Boolean(file),
    );
    const uploadedAttachmentsById = new Map(
      uploadedAttachments.map((file) => [file.id, file]),
    );

    const sent: Array<{ groupKey: string; recipientEmail: string }> = [];
    for (const input of selectedInputs) {
      const resolvedKey =
        !input.groupKey || input.groupKey === "default"
          ? groups[0]?.key
          : input.groupKey;
      currentGroupKey = resolvedKey ?? null;
      const group = resolvedKey ? groupsByKey.get(resolvedKey) : undefined;
      if (!group) {
        throw new DomainError("Purchase order email group was not found.", 400);
      }
      const alreadySent =
        sentGroupKeys.has(group.key) ||
        (!group.isFreight && sentGroupKeys.has("default"));
      if (alreadySent && input.resend !== true) {
        currentGroupKey = null;
        continue;
      }
      const recipientEmail = input.to?.trim();
      if (!recipientEmail) {
        throw new DomainError("Supplier email must be a valid email address.", 400);
      }
      const subject = input.subject?.trim();
      if (!subject) {
        throw new DomainError("Subject is required.", 400);
      }
      const pdf = await renderToBuffer(
        <PurchaseOrderDocument
          order={group.order}
          lines={group.lines}
          additionalCosts={group.additionalCosts}
          organizationName={data.organizationName}
          variant={group.isFreight ? "freight" : "standard"}
        />,
      );
      const safeOrderNumber =
        sanitizePdfFileSegment(data.order.orderNumber) || "purchase-order";
      const fileSuffix = group.isFreight
        ? `-${sanitizePdfFileSegment(group.supplier.name) || "freight"}`
        : "";
      const message =
        input.message?.trim() ||
        `Please review purchase order ${data.order.orderNumber}.${
          input.includePdf !== false ? " The PDF is attached." : ""
        }`;
      const html = `<div>${escapeHtml(message).replace(/\n/g, "<br />")}</div>`;
      const generatedPdfAttachment =
        input.includePdf === false
          ? []
          : [
              {
                filename: `${safeOrderNumber}${fileSuffix}.pdf`,
                content: pdf.toString("base64"),
                contentType: "application/pdf",
              },
            ];
      const selectedUploadedAttachments = (input.attachmentFileIds ?? [])
        .map((fileId) => uploadedAttachmentsById.get(fileId))
        .filter(
          (file): file is { id: string; filename: string; contentType: string; content: string } =>
            Boolean(file),
        )
        .map(({ filename, contentType, content }) => ({
          filename,
          contentType,
          content,
        }));

      await sendTransactionalEmail({
        tag: "purchase-order",
        from: formatEmailFromDisplayName(data.organizationName),
        to: recipientEmail,
        replyTo: input.replyTo?.trim() || undefined,
        bcc: input.bcc?.trim() || undefined,
        subject,
        html,
        text: message,
        attachments: [
          ...generatedPdfAttachment,
          ...selectedUploadedAttachments,
        ],
        idempotencyKey: `${params.idempotencyKey}:${group.key}`,
      });

      await persistPurchaseOrderEmailOutcome(params.orgId, params.orderId, {
        status: "sent",
      }, group.key);
      sent.push({ groupKey: group.key, recipientEmail });
      currentGroupKey = null;
    }
    await tryRecordAccountingAuditEvent({
      organizationId: params.orgId,
      actor: { type: "user", userId: params.actorUserId },
      eventType: "accounting_email",
      outcome: "success",
      source: "lib/purchasing/send-purchase-order-email:sendPurchaseOrderEmail",
      localEntityType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
      localEntityId: params.orderId,
      metadata: { status: "sent" },
    });

    return { status: "sent", sent };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Failed to send PO.";
    await persistPurchaseOrderEmailOutcome(params.orgId, params.orderId, {
      status: "failed",
      error: message,
    }, currentGroupKey ?? firstSelectedGroupKey ?? "default");
    await tryRecordAccountingAuditEvent({
      organizationId: params.orgId,
      actor: { type: "user", userId: params.actorUserId },
      eventType: "accounting_email",
      outcome: "failure",
      source: "lib/purchasing/send-purchase-order-email:sendPurchaseOrderEmail",
      localEntityType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
      localEntityId: params.orderId,
      metadata: accountingAuditErrorMetadata(error),
    });
    if (error instanceof DomainError) {
      throw error;
    }

    throw new DomainError(message, 502);
  }
}
