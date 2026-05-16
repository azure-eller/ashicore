import { eq, sql } from "drizzle-orm";
import { expect, test } from "../fixtures";
import {
  accountingAuditErrorMetadata,
  redactAccountingAuditMetadata,
} from "@/lib/accounting/audit-redaction";
import { db as appDb } from "@/lib/db";
import { integrationAuditEvents } from "@/lib/db/schema";
import { readTestEnv } from "../../helpers/test-env";

const { TEST_ORG_ID } = readTestEnv();

test.describe("Accounting audit events", () => {
  test("redacts forbidden metadata keys recursively", () => {
    const redacted = redactAccountingAuditMetadata({
      count: 2,
      oauthCode: "code-secret",
      nested: {
        refreshToken: "refresh-secret",
        statusCode: 401,
      },
      rows: [{ cookie: "session-secret", safe: "ok" }],
      errorMessage: "failed with Bearer abc.def access_token=secret",
    });

    expect(redacted).toEqual({
      count: 2,
      oauthCode: "[Filtered]",
      nested: {
        refreshToken: "[Filtered]",
        statusCode: 401,
      },
      rows: [{ cookie: "[Filtered]", safe: "ok" }],
      errorMessage: "failed with Bearer [Filtered] access_token=[Filtered]",
    });

    expect(
      accountingAuditErrorMetadata({
        name: "XeroError",
        message: "failed",
        refreshToken: "secret",
        response: { statusCode: 403 },
      })
    ).toEqual({
      errorName: "XeroError",
      message: "failed",
      oauthError: undefined,
      statusCode: 403,
    });
  });

  test("records org-scoped append-only events", async ({ db }) => {
    const source = `test-${Date.now()}`;
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${TEST_ORG_ID}, true)`);
      await tx.insert(integrationAuditEvents).values({
        organizationId: TEST_ORG_ID,
        actorType: "user",
        actorUserId: "audit-user",
        eventType: "xero_settings_update",
        outcome: "success",
        source,
        provider: "xero",
        tenantId: "tenant-1",
        tenantName: "Demo Company",
        metadata: redactAccountingAuditMetadata({
          autoPushSalesInvoices: true,
          accessToken: "secret-token",
        }) as Record<string, unknown>,
      });
    });

    const [event] = await db
      .select()
      .from(integrationAuditEvents)
      .where(eq(integrationAuditEvents.source, source));

    expect(event).toMatchObject({
      organizationId: TEST_ORG_ID,
      actorType: "user",
      actorUserId: "audit-user",
      processName: null,
      eventType: "xero_settings_update",
      outcome: "success",
      provider: "xero",
      tenantId: "tenant-1",
      tenantName: "Demo Company",
    });
    expect(event.metadata).toEqual({
      autoPushSalesInvoices: true,
      accessToken: "[Filtered]",
    });

    await expect(
      appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${TEST_ORG_ID}, true)`);
        await tx
          .update(integrationAuditEvents)
          .set({ outcome: "failure" })
          .where(eq(integrationAuditEvents.id, event.id));
      })
    ).rejects.toThrow();

    await expect(
      appDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${TEST_ORG_ID}, true)`);
        await tx
          .delete(integrationAuditEvents)
          .where(eq(integrationAuditEvents.id, event.id));
      })
    ).rejects.toThrow();
  });

  test("RLS hides another organization's audit events", async ({ db }) => {
    const otherOrgId = `audit-other-${Date.now()}`;
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${otherOrgId}, true)`);
      await tx.insert(integrationAuditEvents).values({
        organizationId: otherOrgId,
        actorType: "process",
        processName: "test-process",
        eventType: "xero_retry",
        outcome: "failure",
        source: "test-other-org",
        provider: "xero",
        metadata: { errorCount: 1 },
      });
    });

    const rows = await db
      .select()
      .from(integrationAuditEvents)
      .where(eq(integrationAuditEvents.source, "test-other-org"));
    expect(rows).toHaveLength(0);

    const ownerRows = await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${otherOrgId}, true)`);
      return tx
        .select()
        .from(integrationAuditEvents)
        .where(eq(integrationAuditEvents.source, "test-other-org"));
    });
    expect(ownerRows).toHaveLength(1);
  });
});
