import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { DomainError } from "@/lib/errors/domain-error";
import {
  customerContacts,
  marketingExperiments,
  marketingMailboxes,
} from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import type { MarketingExperimentConfig } from "@/lib/schemas/marketing";
import { assertMarketingCorpusReady } from "./corpus";
import { isMarketingTestMode } from "./runtime-policy";

function initialState(config: MarketingExperimentConfig) {
  return {
    activatedAt: null,
    lastSentAt: null,
    canaryCompletedAt: null,
    contactProgress: Object.fromEntries(
      config.contactIds.map((contactId) => [
        contactId,
        {
          status: "pending" as const,
          processingLeaseId: null,
          processingLeaseExpiresAt: null,
          followUpLeaseId: null,
          followUpLeaseExpiresAt: null,
          activityId: null,
          sentAt: null,
          followUpSentAt: null,
          outcome: null,
          reason: null,
        },
      ]),
    ),
  };
}

export async function createMarketingExperiment(args: {
  orgId: string;
  userId: string;
  config: MarketingExperimentConfig;
}) {
  const contactIds = [...new Set(args.config.contactIds)];
  if (contactIds.length !== args.config.contactIds.length) {
    throw new DomainError("Experiment contact IDs must be unique.", 400);
  }

  return withOrgContext(args.orgId, async (tx) => {
    const contacts = await tx
      .select({ id: customerContacts.id, email: customerContacts.email })
      .from(customerContacts)
      .where(
        and(
          inArray(customerContacts.id, contactIds),
          isNull(customerContacts.deletedAt),
          isNull(customerContacts.outreachSuppressedAt),
        ),
      );

    if (contacts.length !== contactIds.length || contacts.some((row) => !row.email)) {
      throw new DomainError(
        "Every experiment contact must exist, have an email address, and be eligible for outreach.",
        400,
      );
    }

    const config = { ...args.config, contactIds };
    const [created] = await tx
      .insert(marketingExperiments)
      .values({
        organizationId: args.orgId,
        createdByUserId: args.userId,
        config,
        state: initialState(config),
      })
      .returning();

    if (!created) throw new DomainError("Failed to create marketing experiment.", 500);
    return created;
  }, { userId: args.userId });
}

export async function listMarketingExperiments(orgId: string, userId: string) {
  return withOrgContext(
    orgId,
    (tx) =>
      tx
        .select()
        .from(marketingExperiments)
        .orderBy(marketingExperiments.createdAt),
    { userId },
  );
}

export async function getMarketingExperiment(
  orgId: string,
  userId: string,
  experimentId: string,
) {
  return withOrgContext(
    orgId,
    async (tx) => {
      const [row] = await tx
        .select()
        .from(marketingExperiments)
        .where(eq(marketingExperiments.id, experimentId));
      if (!row) throw new DomainError("Marketing experiment not found.", 404);
      return row;
    },
    { userId },
  );
}

export async function activateMarketingExperiment(
  orgId: string,
  userId: string,
  experimentId: string,
) {
  await assertMarketingCorpusReady();

  return withOrgContext(orgId, async (tx) => {
    const [experiment] = await tx
      .select()
      .from(marketingExperiments)
      .where(eq(marketingExperiments.id, experimentId));
    if (!experiment) throw new DomainError("Marketing experiment not found.", 404);
    if (experiment.status === "completed") {
      throw new DomainError("Completed experiments cannot be reactivated.", 409);
    }
    if (experiment.status !== "active") {
      const [active] = await tx
        .select({ id: marketingExperiments.id })
        .from(marketingExperiments)
        .where(eq(marketingExperiments.status, "active"));
      if (active && active.id !== experimentId) {
        throw new DomainError("Pause the active marketing experiment first.", 409);
      }
    }

    if (!(await isMarketingTestMode())) {
      const [mailbox] = await tx
        .select({ id: marketingMailboxes.id })
        .from(marketingMailboxes)
        .where(
          and(
            eq(marketingMailboxes.organizationId, orgId),
            isNull(marketingMailboxes.disabledAt),
          ),
        );
      if (!mailbox) throw new DomainError("Connect the founder Gmail mailbox first.", 409);
    }

    const now = new Date();
    const [updated] = await tx
      .update(marketingExperiments)
      .set({
        status: "active",
        state: {
          ...experiment.state,
          activatedAt: experiment.state.activatedAt ?? now.toISOString(),
        },
        updatedAt: now,
      })
      .where(eq(marketingExperiments.id, experimentId))
      .returning();
    return updated!;
  }, { userId });
}

export async function pauseMarketingExperiment(
  orgId: string,
  userId: string,
  experimentId: string,
) {
  return withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(marketingExperiments)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(marketingExperiments.id, experimentId))
      .returning();
    if (!updated) throw new DomainError("Marketing experiment not found.", 404);
    return updated;
  }, { userId });
}

export async function setMarketingContactSuppression(args: {
  orgId: string;
  userId: string;
  contactId: string;
  suppressed: boolean;
  reason?: string;
}) {
  return withOrgContext(args.orgId, async (tx) => {
    const [updated] = await tx
      .update(customerContacts)
      .set({
        outreachSuppressedAt: args.suppressed ? new Date() : null,
        outreachSuppressionReason: args.suppressed
          ? (args.reason ?? "manual")
          : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerContacts.id, args.contactId),
          isNull(customerContacts.deletedAt),
        ),
      )
      .returning({
        id: customerContacts.id,
        outreachSuppressedAt: customerContacts.outreachSuppressedAt,
        outreachSuppressionReason: customerContacts.outreachSuppressionReason,
      });
    if (!updated) throw new DomainError("Marketing contact not found.", 404);
    return updated;
  }, { userId: args.userId });
}
