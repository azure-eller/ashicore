import "server-only";

import { and, eq, sql } from "drizzle-orm";
import {
  integrationExternalRecords,
  type IntegrationExternalEntityType,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

export type ExternalRecordInput = {
  organizationId: string;
  provider: string;
  entityType: IntegrationExternalEntityType;
  localRecordId: string;
  externalId?: string | null;
  externalCode?: string | null;
  externalName?: string | null;
  externalDescription?: string | null;
  metadata?: Record<string, unknown> | null;
  externalUpdatedAt?: Date | null;
};

export async function upsertExternalRecordInTx(tx: Tx, input: ExternalRecordInput) {
  await tx
    .insert(integrationExternalRecords)
    .values({
      organizationId: input.organizationId,
      provider: input.provider,
      entityType: input.entityType,
      localRecordId: input.localRecordId,
      externalId: input.externalId ?? null,
      externalCode: input.externalCode ?? null,
      externalName: input.externalName ?? null,
      externalDescription: input.externalDescription ?? null,
      metadata: input.metadata ?? null,
      externalUpdatedAt: input.externalUpdatedAt ?? null,
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
        externalId: input.externalId ?? null,
        externalCode: input.externalCode ?? null,
        externalName: input.externalName ?? null,
        externalDescription: input.externalDescription ?? null,
        metadata: input.metadata ?? null,
        externalUpdatedAt: input.externalUpdatedAt ?? null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function getExternalRecordInTx(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    entityType: IntegrationExternalEntityType;
    localRecordId: string;
  }
) {
  const [row] = await tx
    .select()
    .from(integrationExternalRecords)
    .where(
      and(
        eq(integrationExternalRecords.organizationId, params.organizationId),
        eq(integrationExternalRecords.provider, params.provider),
        eq(integrationExternalRecords.entityType, params.entityType),
        eq(integrationExternalRecords.localRecordId, params.localRecordId)
      )
    );

  return row ?? null;
}

export async function getExternalRecordByExternalIdInTx(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    entityType: IntegrationExternalEntityType;
    externalId: string;
  }
) {
  const [row] = await tx
    .select()
    .from(integrationExternalRecords)
    .where(
      and(
        eq(integrationExternalRecords.organizationId, params.organizationId),
        eq(integrationExternalRecords.provider, params.provider),
        eq(integrationExternalRecords.entityType, params.entityType),
        eq(integrationExternalRecords.externalId, params.externalId)
      )
    )
    .limit(1);

  return row ?? null;
}

export async function getExternalRecordIdInTx(
  tx: Tx,
  params: {
    organizationId: string;
    provider: string;
    entityType: IntegrationExternalEntityType;
    localRecordId: string;
  }
) {
  return (await getExternalRecordInTx(tx, params))?.externalId ?? null;
}

export function externalMetadataValue<T extends string>(
  metadata: Record<string, unknown> | null,
  key: string
): T | null {
  const value = metadata?.[key];
  return typeof value === "string" ? (value as T) : null;
}

export function jsonbText(column: unknown, key: string) {
  return sql<string | null>`${column} ->> ${key}`;
}
