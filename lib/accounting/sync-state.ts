import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  accountingAttachmentSyncs,
  accountingDocumentSyncs,
  attachmentFiles,
} from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";

export {
  ACCOUNTING_PROVIDER_LABELS,
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  ACCOUNTING_PROVIDER_XERO,
  ACCOUNTING_PROVIDERS,
  type AccountingProvider,
} from "@/lib/accounting/constants";

export const ACCOUNTING_DOCUMENT_PURCHASE_ORDER = "purchase_order";
export const ACCOUNTING_DOCUMENT_PURCHASE_BILL = "purchase_bill";
export const ACCOUNTING_DOCUMENT_SALES_ORDER = "sales_order";
export const ACCOUNTING_DOCUMENT_SALES_SHIPMENT = "sales_shipment";
export const ATTACHMENT_OWNER_PURCHASE_ORDER = "purchase_order";

type AttachmentFile = typeof attachmentFiles.$inferSelect;

type AccountingDocumentMetadata = {
  pushStatus?: string;
  providerDocumentType?: string | null;
  idempotencyKey?: string | null;
  payloadSnapshot?: Record<string, unknown> | null;
};

function accountingDocumentMetadataValues(params: AccountingDocumentMetadata) {
  return {
    ...(params.pushStatus !== undefined ? { pushStatus: params.pushStatus } : {}),
    ...(params.providerDocumentType !== undefined
      ? { providerDocumentType: params.providerDocumentType }
      : {}),
    ...(params.idempotencyKey !== undefined
      ? { idempotencyKey: params.idempotencyKey }
      : {}),
    ...(params.payloadSnapshot !== undefined
      ? { pushPayloadSnapshot: params.payloadSnapshot }
      : {}),
  };
}

export async function markAccountingDocumentPushAttempt(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    documentType: string;
    documentId: string;
    pushStatus?: string;
    providerDocumentType?: string | null;
    idempotencyKey?: string | null;
    payloadSnapshot?: Record<string, unknown> | null;
  }
) {
  const metadataValues = accountingDocumentMetadataValues(params);
  await tx
    .insert(accountingDocumentSyncs)
    .values({
      organizationId: params.organizationId,
      provider: params.provider,
      documentType: params.documentType,
      documentId: params.documentId,
      ...metadataValues,
      lastPushAttemptAt: new Date(),
      retryCount: 1,
    })
    .onConflictDoUpdate({
      target: [
        accountingDocumentSyncs.organizationId,
        accountingDocumentSyncs.provider,
        accountingDocumentSyncs.documentType,
        accountingDocumentSyncs.documentId,
      ],
      set: {
        lastPushAttemptAt: new Date(),
        retryCount: sql`${accountingDocumentSyncs.retryCount} + 1`,
        pushError: null,
        ...metadataValues,
        updatedAt: new Date(),
      },
    });
}

export async function persistAccountingDocumentPushSuccess(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    documentType: string;
    documentId: string;
    externalDocumentId: string;
    externalDocumentNumber: string;
    payloadHash: string;
    providerDocumentType?: string | null;
    idempotencyKey?: string | null;
    payloadSnapshot?: Record<string, unknown> | null;
  }
) {
  const metadataValues = accountingDocumentMetadataValues(params);
  await tx
    .insert(accountingDocumentSyncs)
    .values({
      organizationId: params.organizationId,
      provider: params.provider,
      documentType: params.documentType,
      documentId: params.documentId,
      externalDocumentId: params.externalDocumentId,
      externalDocumentNumber: params.externalDocumentNumber,
      pushStatus: "pushed",
      pushError: null,
      pushedAt: new Date(),
      pushPayloadHash: params.payloadHash,
      ...metadataValues,
      retryCount: 0,
    })
    .onConflictDoUpdate({
      target: [
        accountingDocumentSyncs.organizationId,
        accountingDocumentSyncs.provider,
        accountingDocumentSyncs.documentType,
        accountingDocumentSyncs.documentId,
      ],
      set: {
        externalDocumentId: params.externalDocumentId,
        externalDocumentNumber: params.externalDocumentNumber,
        pushStatus: "pushed",
        pushError: null,
        pushedAt: new Date(),
        pushPayloadHash: params.payloadHash,
        ...metadataValues,
        retryCount: 0,
        updatedAt: new Date(),
      },
    });
}

export async function persistAccountingDocumentPushFailure(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    documentType: string;
    documentId: string;
    error: string;
    providerDocumentType?: string | null;
    idempotencyKey?: string | null;
    payloadSnapshot?: Record<string, unknown> | null;
  }
) {
  const metadataValues = accountingDocumentMetadataValues(params);
  await tx
    .insert(accountingDocumentSyncs)
    .values({
      organizationId: params.organizationId,
      provider: params.provider,
      documentType: params.documentType,
      documentId: params.documentId,
      pushStatus: "failed",
      pushError: params.error,
      ...metadataValues,
    })
    .onConflictDoUpdate({
      target: [
        accountingDocumentSyncs.organizationId,
        accountingDocumentSyncs.provider,
        accountingDocumentSyncs.documentType,
        accountingDocumentSyncs.documentId,
      ],
      set: {
        pushStatus: "failed",
        pushError: params.error,
        ...metadataValues,
        updatedAt: new Date(),
      },
    });
}

export async function resetAccountingDocumentPushState(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    documentType: string;
    documentId: string;
  }
) {
  await tx
    .update(accountingDocumentSyncs)
    .set({
      externalDocumentId: null,
      externalDocumentNumber: null,
      pushStatus: null,
      pushError: null,
      pushedAt: null,
      pushPayloadHash: null,
      pushPayloadSnapshot: null,
      providerDocumentType: null,
      idempotencyKey: null,
      retryCount: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accountingDocumentSyncs.organizationId, params.organizationId),
        eq(accountingDocumentSyncs.provider, params.provider),
        eq(accountingDocumentSyncs.documentType, params.documentType),
        eq(accountingDocumentSyncs.documentId, params.documentId)
      )
    );
}

export async function persistAccountingDocumentEmailOutcome(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    documentType: string;
    documentId: string;
    outcome:
      | { status: "sent"; error?: never }
      | { status: "failed"; error: string }
      | { status: "skipped"; error?: never };
  }
) {
  const update = {
    emailStatus: params.outcome.status,
    emailError: params.outcome.status === "failed" ? params.outcome.error : null,
    emailedAt: params.outcome.status === "sent" ? new Date() : undefined,
    updatedAt: new Date(),
  };

  await tx
    .insert(accountingDocumentSyncs)
    .values({
      organizationId: params.organizationId,
      provider: params.provider,
      documentType: params.documentType,
      documentId: params.documentId,
      emailStatus: params.outcome.status,
      emailError: params.outcome.status === "failed" ? params.outcome.error : null,
      emailedAt: params.outcome.status === "sent" ? new Date() : undefined,
    })
    .onConflictDoUpdate({
      target: [
        accountingDocumentSyncs.organizationId,
        accountingDocumentSyncs.provider,
        accountingDocumentSyncs.documentType,
        accountingDocumentSyncs.documentId,
      ],
      set: update,
    });
}

export async function markAttachmentSyncAttempt(
  tx: Tx,
  params: { organizationId: string; provider: string; attachmentId: string }
) {
  await tx
    .insert(accountingAttachmentSyncs)
    .values({
      organizationId: params.organizationId,
      provider: params.provider,
      attachmentId: params.attachmentId,
      lastSyncAttemptAt: new Date(),
      retryCount: 1,
    })
    .onConflictDoUpdate({
      target: [
        accountingAttachmentSyncs.organizationId,
        accountingAttachmentSyncs.provider,
        accountingAttachmentSyncs.attachmentId,
      ],
      set: {
        lastSyncAttemptAt: new Date(),
        retryCount: sql`${accountingAttachmentSyncs.retryCount} + 1`,
        updatedAt: new Date(),
      },
    });
}

export async function persistAttachmentSyncSuccess(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    attachmentId: string;
    externalAttachmentId: string | null;
  }
) {
  await tx
    .insert(accountingAttachmentSyncs)
    .values({
      organizationId: params.organizationId,
      provider: params.provider,
      attachmentId: params.attachmentId,
      externalAttachmentId: params.externalAttachmentId,
      syncStatus: "synced",
      syncError: null,
      syncedAt: new Date(),
      retryCount: 0,
    })
    .onConflictDoUpdate({
      target: [
        accountingAttachmentSyncs.organizationId,
        accountingAttachmentSyncs.provider,
        accountingAttachmentSyncs.attachmentId,
      ],
      set: {
        externalAttachmentId: params.externalAttachmentId,
        syncStatus: "synced",
        syncError: null,
        syncedAt: new Date(),
        retryCount: 0,
        updatedAt: new Date(),
      },
    });
}

export async function persistAttachmentSyncFailure(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    attachmentId: string;
    error: string;
  }
) {
  await tx
    .insert(accountingAttachmentSyncs)
    .values({
      organizationId: params.organizationId,
      provider: params.provider,
      attachmentId: params.attachmentId,
      syncStatus: "failed",
      syncError: params.error,
    })
    .onConflictDoUpdate({
      target: [
        accountingAttachmentSyncs.organizationId,
        accountingAttachmentSyncs.provider,
        accountingAttachmentSyncs.attachmentId,
      ],
      set: {
        syncStatus: "failed",
        syncError: params.error,
        updatedAt: new Date(),
      },
    });
}

export async function listUnsyncedAttachmentsForOwner(
  orgId: string,
  params: { provider: string; ownerType: string; ownerId: string }
): Promise<AttachmentFile[]> {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: attachmentFiles.id,
        organizationId: attachmentFiles.organizationId,
        ownerType: attachmentFiles.ownerType,
        ownerId: attachmentFiles.ownerId,
        storageKey: attachmentFiles.storageKey,
        blobUrl: attachmentFiles.blobUrl,
        filename: attachmentFiles.filename,
        contentType: attachmentFiles.contentType,
        sizeBytes: attachmentFiles.sizeBytes,
        uploadedByUserId: attachmentFiles.uploadedByUserId,
        uploadedByName: attachmentFiles.uploadedByName,
        deletedAt: attachmentFiles.deletedAt,
        createdAt: attachmentFiles.createdAt,
        updatedAt: attachmentFiles.updatedAt,
      })
      .from(attachmentFiles)
      .leftJoin(
        accountingAttachmentSyncs,
        and(
          eq(accountingAttachmentSyncs.organizationId, orgId),
          eq(accountingAttachmentSyncs.provider, params.provider),
          eq(accountingAttachmentSyncs.attachmentId, attachmentFiles.id),
          eq(accountingAttachmentSyncs.syncStatus, "synced")
        )
      )
      .where(
        and(
          eq(attachmentFiles.organizationId, orgId),
          eq(attachmentFiles.ownerType, params.ownerType),
          eq(attachmentFiles.ownerId, params.ownerId),
          isNull(attachmentFiles.deletedAt),
          isNull(accountingAttachmentSyncs.id)
        )
      )
      .orderBy(attachmentFiles.createdAt, attachmentFiles.id);

    return rows;
  });
}
