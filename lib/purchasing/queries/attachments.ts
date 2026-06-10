import "server-only";

import {
  and,
  desc,
  eq,
  isNull,
} from "drizzle-orm";
import { accountingAttachmentSyncs, attachmentFiles, purchaseOrders } from "@/lib/db/schema";
import { ACCOUNTING_PROVIDER_XERO, ATTACHMENT_OWNER_PURCHASE_ORDER } from "@/lib/accounting/sync-state";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import type { PurchaseOrderAttachment } from "../types";

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

export async function getPurchaseOrderAttachmentsInTx(
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
