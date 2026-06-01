import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
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

type PurchaseOrderEmailData = {
  order: PurchaseOrderPdf & {
    id: string;
    status: string;
    supplierEmail: string | null;
  };
  organizationName: string;
  lines: PurchaseOrderPdfLine[];
  additionalCosts: PurchaseOrderPdfAdditionalCost[];
  attachments: {
    filename: string;
    contentType: string;
    blobUrl: string;
  }[];
};

async function loadPurchaseOrderEmailDataInTx(
  tx: Tx,
  orderId: string,
): Promise<PurchaseOrderEmailData | null> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
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
      costType: purchaseOrderAdditionalCosts.costType,
      reference: purchaseOrderAdditionalCosts.reference,
      amount: purchaseOrderAdditionalCosts.amount,
    })
    .from(purchaseOrderAdditionalCosts)
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId))
    .orderBy(purchaseOrderAdditionalCosts.sortOrder);

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
      })),
    attachments,
  };
}

function sanitizePdfFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
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
) {
  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentEmailOutcome(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
      documentId: orderId,
      outcome,
    });
  });
}

export async function renderPurchaseOrderPdfBuffer(
  orgId: string,
  orderId: string,
) {
  const data = await withOrgContext(orgId, async (tx) =>
    loadPurchaseOrderEmailDataInTx(tx, orderId),
  );
  if (!data) return null;

  const buffer = await renderToBuffer(
    <PurchaseOrderDocument
      order={data.order}
      lines={data.lines}
      additionalCosts={data.additionalCosts}
      organizationName={data.organizationName}
    />,
  );

  return {
    orderNumber: data.order.orderNumber,
    buffer,
  };
}

export async function sendPurchaseOrderEmail(params: {
  orgId: string;
  orderId: string;
  actorUserId: string;
  idempotencyKey: string;
  input: SendPurchaseOrderEmail;
}): Promise<{ status: "sent"; recipientEmail: string }> {
  const data = await withOrgContext(params.orgId, async (tx) =>
    loadPurchaseOrderEmailDataInTx(tx, params.orderId),
  );
  if (!data) {
    throw new DomainError("Purchase order not found.", 404);
  }
  if (data.order.status === "draft") {
    throw new DomainError("Submit the purchase order before sending it.", 400);
  }
  if (data.order.status === "cancelled") {
    throw new DomainError("Cancelled purchase orders cannot be emailed.", 409);
  }

  try {
    const pdf = await renderToBuffer(
      <PurchaseOrderDocument
        order={data.order}
        lines={data.lines}
        additionalCosts={data.additionalCosts}
        organizationName={data.organizationName}
      />,
    );
    const safeOrderNumber =
      sanitizePdfFileSegment(data.order.orderNumber) || "purchase-order";
    const message =
      params.input.message?.trim() ||
      `Please review purchase order ${data.order.orderNumber}. The PDF is attached.`;
    const html = `<div>${escapeHtml(message).replace(/\n/g, "<br />")}</div>`;

    const uploadedAttachments = (
      await Promise.all(
        data.attachments.map(async (file) => {
          const content = await attachmentContentBase64(file.blobUrl);
          if (!content) {
            throw new DomainError(`Attachment "${file.filename}" could not be read.`, 503);
          }
          return {
            filename: file.filename,
            contentType: file.contentType,
            content,
          };
        }),
      )
    ).filter((file): file is { filename: string; contentType: string; content: string } =>
      Boolean(file),
    );

    await sendTransactionalEmail({
      tag: "purchase-order",
      to: params.input.to,
      replyTo: params.input.replyTo?.trim() || undefined,
      bcc: params.input.bcc?.trim() || undefined,
      subject: params.input.subject,
      html,
      text: message,
      attachments: [
        {
          filename: `${safeOrderNumber}.pdf`,
          content: pdf.toString("base64"),
          contentType: "application/pdf",
        },
        ...uploadedAttachments,
      ],
      idempotencyKey: params.idempotencyKey,
    });

    await persistPurchaseOrderEmailOutcome(params.orgId, params.orderId, {
      status: "sent",
    });
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

    return { status: "sent", recipientEmail: params.input.to };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Failed to send PO.";
    await persistPurchaseOrderEmailOutcome(params.orgId, params.orderId, {
      status: "failed",
      error: message,
    });
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
