import "server-only";

import { integrationAuditEvents } from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { ACCOUNTING_PROVIDER_XERO, type AccountingProvider } from "./constants";
import {
  accountingAuditErrorMetadata,
  redactAccountingAuditMetadata,
} from "./audit-redaction";

export type AccountingAuditEventType =
  | "accounting_connect_started"
  | "accounting_connect_callback"
  | "accounting_disconnect"
  | "accounting_tenant_switch"
  | "accounting_settings_update"
  | "accounting_import"
  | "accounting_import_undo"
  | "accounting_auto_sync"
  | "accounting_push"
  | "accounting_retry"
  | "accounting_email"
  | "accounting_token_refresh"
  | "accounting_missing_scope"
  | "xero_connect_started"
  | "xero_connect_callback"
  | "xero_disconnect"
  | "xero_tenant_switch"
  | "xero_settings_update"
  | "xero_import"
  | "xero_import_undo"
  | "xero_push"
  | "xero_retry"
  | "xero_email"
  | "xero_token_refresh"
  | "xero_missing_scope";

export type AccountingAuditOutcome = "success" | "failure";

type AccountingAuditActor =
  | { type: "user"; userId: string }
  | { type: "process"; processName: string };

export type AccountingAuditEventInput = {
  organizationId: string;
  actor: AccountingAuditActor;
  eventType: AccountingAuditEventType;
  outcome: AccountingAuditOutcome;
  source: string;
  provider?: AccountingProvider;
  tenantId?: string | null;
  tenantName?: string | null;
  localEntityType?: string | null;
  localEntityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordAccountingAuditEventInTx(
  tx: Tx,
  input: AccountingAuditEventInput
) {
  await tx.insert(integrationAuditEvents).values({
    organizationId: input.organizationId,
    actorType: input.actor.type,
    actorUserId: input.actor.type === "user" ? input.actor.userId : null,
    processName: input.actor.type === "process" ? input.actor.processName : null,
    eventType: input.eventType,
    outcome: input.outcome,
    source: input.source,
    provider: input.provider ?? ACCOUNTING_PROVIDER_XERO,
    tenantId: input.tenantId ?? null,
    tenantName: input.tenantName ?? null,
    localEntityType: input.localEntityType ?? null,
    localEntityId: input.localEntityId ?? null,
    metadata: input.metadata
      ? (redactAccountingAuditMetadata(input.metadata) as Record<string, unknown>)
      : null,
  });
}

export { accountingAuditErrorMetadata, redactAccountingAuditMetadata };

export async function recordAccountingAuditEvent(input: AccountingAuditEventInput) {
  await withOrgContext(input.organizationId, async (tx) => {
    await recordAccountingAuditEventInTx(tx, input);
  });
}

export async function tryRecordAccountingAuditEvent(
  input: AccountingAuditEventInput
) {
  try {
    await recordAccountingAuditEvent(input);
  } catch (error) {
    console.error("Accounting audit event write failed:", {
      eventType: input.eventType,
      provider: input.provider ?? ACCOUNTING_PROVIDER_XERO,
      source: input.source,
      error: (error as Error)?.message ?? "unknown",
    });
  }
}
