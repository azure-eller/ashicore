import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  customerActivities,
  customerActivityAttendees,
  customerContacts,
  customers,
  marketingExperiments,
  organization,
} from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import { env } from "@/lib/env";
import { sendFounderAlert } from "@/lib/internal-alerts";
import {
  marketingExperimentStateSchema,
  type MarketingActivityMetadata,
  type MarketingContactProgress,
  type MarketingExperimentState,
} from "@/lib/schemas/marketing";
import { assertMarketingCorpusReady } from "./corpus";
import {
  analyzeMarketingExperiment,
  classifyMarketingReply,
  evaluateMarketingDraft,
  generateMarketingDraft,
  generateMarketingFollowUp,
  MARKETING_PROMPT_VERSION,
  marketingModelName,
} from "./generation";
import {
  acknowledgeGmailHistory,
  readNewGmailMessages,
  sendGmailMessage,
} from "./gmail";
import { isMarketingTestMode } from "./runtime-policy";

const PROCESSING_LEASE_MS = 15 * 60 * 1_000;
const FOLLOW_UP_AFTER_MS = 5 * 24 * 60 * 60 * 1_000;
const EVALUATION_DELAY_MS = 7 * 24 * 60 * 60 * 1_000;

type ActiveExperiment = typeof marketingExperiments.$inferSelect;

function localDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    weekday: parts.find((part) => part.type === "weekday")?.value ?? "",
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? -1),
  };
}

async function sendWindowOpen(now: Date, timeZone: string) {
  if (await isMarketingTestMode()) return true;
  const { weekday, hour } = localParts(now, timeZone);
  return !["Sat", "Sun"].includes(weekday) && hour >= 8 && hour < 10;
}

function progressValues(state: MarketingExperimentState) {
  return Object.values(state.contactProgress);
}

function sentCount(state: MarketingExperimentState) {
  return progressValues(state).filter((row) =>
    ["sent", "bounced", "replied"].includes(row.status),
  ).length;
}

function reservedCount(state: MarketingExperimentState, now: Date) {
  return progressValues(state).filter(
    (row) =>
      (row.status === "processing" &&
        row.processingLeaseExpiresAt != null &&
        new Date(row.processingLeaseExpiresAt).getTime() > now.getTime()) ||
      (row.followUpLeaseExpiresAt != null &&
        new Date(row.followUpLeaseExpiresAt).getTime() > now.getTime()),
  ).length;
}

function dailyAllowance(state: MarketingExperimentState, now: Date, timeZone: string) {
  const sent = sentCount(state);
  if (sent < 3) return 3 - sent;
  const today = localDateKey(now, timeZone);
  if (
    state.canaryCompletedAt &&
    localDateKey(new Date(state.canaryCompletedAt), timeZone) === today
  ) {
    return 0;
  }
  const sentToday = progressValues(state).filter(
    (row) =>
      (row.sentAt && localDateKey(new Date(row.sentAt), timeZone) === today) ||
      (row.followUpSentAt &&
        localDateKey(new Date(row.followUpSentAt), timeZone) === today),
  ).length;
  return Math.max(0, 5 - sentToday);
}

async function loadActiveExperiment(orgId: string) {
  return withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select()
      .from(marketingExperiments)
      .where(eq(marketingExperiments.status, "active"));
    return row ?? null;
  });
}

async function persistState(
  orgId: string,
  experimentId: string,
  mutate: (state: MarketingExperimentState) => MarketingExperimentState,
) {
  return withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select({ state: marketingExperiments.state })
      .from(marketingExperiments)
      .where(eq(marketingExperiments.id, experimentId))
      .for("update");
    if (!row) throw new DomainError("Marketing experiment not found.", 404);
    const state = mutate(marketingExperimentStateSchema.parse(row.state));
    await tx
      .update(marketingExperiments)
      .set({ state, updatedAt: new Date() })
      .where(eq(marketingExperiments.id, experimentId));
    return state;
  });
}

async function claimPendingContacts(args: {
  orgId: string;
  experiment: ActiveExperiment;
  now: Date;
  timeZone: string;
}) {
  const leaseId = randomUUID();
  const expiresAt = new Date(args.now.getTime() + PROCESSING_LEASE_MS).toISOString();
  const claimed: string[] = [];
  await withOrgContext(args.orgId, async (tx) => {
    const [row] = await tx
      .select({ state: marketingExperiments.state, status: marketingExperiments.status })
      .from(marketingExperiments)
      .where(eq(marketingExperiments.id, args.experiment.id))
      .for("update");
    if (!row) throw new DomainError("Marketing experiment not found.", 404);
    if (row.status !== "active") return;
    const state = marketingExperimentStateSchema.parse(row.state);
    const limit = Math.max(
      0,
      dailyAllowance(state, args.now, args.timeZone) - reservedCount(state, args.now),
    );
    for (const contactId of args.experiment.config.contactIds) {
      if (claimed.length >= limit) break;
      const progress = state.contactProgress[contactId];
      if (!progress) continue;
      const expired =
        progress.status === "processing" &&
        progress.processingLeaseExpiresAt != null &&
        new Date(progress.processingLeaseExpiresAt).getTime() <= args.now.getTime();
      if (progress.status !== "pending" && !expired) continue;
      state.contactProgress[contactId] = {
        ...progress,
        status: "processing",
        processingLeaseId: leaseId,
        processingLeaseExpiresAt: expiresAt,
      };
      claimed.push(contactId);
    }
    await tx
      .update(marketingExperiments)
      .set({ state, updatedAt: new Date() })
      .where(eq(marketingExperiments.id, args.experiment.id));
  });
  return { leaseId, claimed };
}

async function leaseIsSendable(args: {
  orgId: string;
  experimentId: string;
  contactId: string;
  leaseId: string;
  now: Date;
}) {
  return withOrgContext(args.orgId, async (tx) => {
    const [row] = await tx
      .select({ status: marketingExperiments.status, state: marketingExperiments.state })
      .from(marketingExperiments)
      .where(eq(marketingExperiments.id, args.experimentId));
    if (row?.status !== "active") return false;
    const progress = marketingExperimentStateSchema.parse(row.state).contactProgress[args.contactId];
    return Boolean(
      progress?.status === "processing" &&
        progress.processingLeaseId === args.leaseId &&
        progress.processingLeaseExpiresAt &&
        new Date(progress.processingLeaseExpiresAt).getTime() > args.now.getTime(),
    );
  });
}

async function loadCandidate(orgId: string, contactId: string) {
  return withOrgContext(orgId, async (tx) => {
    const [contact] = await tx
      .select({
        id: customerContacts.id,
        customerId: customerContacts.customerId,
        name: customerContacts.name,
        title: customerContacts.title,
        email: customerContacts.email,
        suppressedAt: customerContacts.outreachSuppressedAt,
        company: customers.name,
      })
      .from(customerContacts)
      .innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(
        and(
          eq(customerContacts.id, contactId),
          isNull(customerContacts.deletedAt),
          isNull(customers.deletedAt),
        ),
      );
    if (!contact?.email || contact.suppressedAt) return null;
    const notes = await tx
      .select({ title: customerActivities.title, body: customerActivities.body })
      .from(customerActivities)
      .where(
        and(
          eq(customerActivities.customerId, contact.customerId),
          isNull(customerActivities.deletedAt),
          isNull(customerActivities.marketingExperimentId),
        ),
      )
      .orderBy(desc(customerActivities.occurredAt))
      .limit(20);
    const evidence = [
      `Company: ${contact.company}`,
      `Recipient: ${contact.name}${contact.title ? `, ${contact.title}` : ""}`,
      ...notes.flatMap((note) =>
        [note.title, note.body]
          .filter((value): value is string => Boolean(value?.trim()))
          .map((value) => value.trim().slice(0, 1_000)),
      ),
    ].slice(0, 12);
    return { ...contact, email: contact.email, evidence } as typeof contact & {
      email: string;
      evidence: string[];
    };
  });
}

async function contactCanReceiveMarketing(
  orgId: string,
  contactId: string,
  email: string,
) {
  return withOrgContext(orgId, async (tx) => {
    const [contact] = await tx
      .select({ id: customerContacts.id })
      .from(customerContacts)
      .innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(
        and(
          eq(customerContacts.id, contactId),
          eq(customerContacts.email, email),
          isNull(customerContacts.deletedAt),
          isNull(customerContacts.outreachSuppressedAt),
          isNull(customers.deletedAt),
        ),
      );
    return Boolean(contact);
  });
}

function complianceFooter() {
  const senderName = env.MARKETING_SENDER_NAME?.trim();
  const postalAddress = env.MARKETING_POSTAL_ADDRESS?.trim();
  if (!senderName || !postalAddress) {
    if (process.env.NODE_ENV === "production") {
      throw new DomainError("Marketing sender identity and postal address are not configured.", 503);
    }
    return "\n\n— Ashicore founder\nTest address\nIf you’d rather I don’t follow up, just say so.";
  }
  return `\n\n— ${senderName} · Ashicore\n${postalAddress}\nIf you’d rather I don’t follow up, just say so.`;
}

async function markContact(args: {
  orgId: string;
  experimentId: string;
  contactId: string;
  leaseId?: string;
  patch: Partial<MarketingContactProgress>;
  lastSentAt?: string;
}) {
  return persistState(args.orgId, args.experimentId, (state) => {
    const current = state.contactProgress[args.contactId];
    if (!current) return state;
    if (args.leaseId && current.processingLeaseId !== args.leaseId) return state;
    state.contactProgress[args.contactId] = {
      ...current,
      ...args.patch,
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
    };
    if (args.lastSentAt) state.lastSentAt = args.lastSentAt;
    if (!state.canaryCompletedAt && sentCount(state) >= 3) {
      state.canaryCompletedAt = args.lastSentAt ?? new Date().toISOString();
    }
    return state;
  });
}

async function pauseForDeliveryFailure(args: {
  orgId: string;
  experimentId: string;
  reason: string;
  activityId?: string;
  metadata?: MarketingActivityMetadata;
}) {
  await withOrgContext(args.orgId, async (tx) => {
    if (args.activityId && args.metadata) {
      await tx
        .update(customerActivities)
        .set({
          marketingMetadata: { ...args.metadata, deliveryStatus: "failed" },
          updatedAt: new Date(),
        })
        .where(eq(customerActivities.id, args.activityId));
    }
    await tx
      .update(marketingExperiments)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(marketingExperiments.id, args.experimentId));
  });
  await sendFounderAlert({
    kind: "marketing_experiment",
    subject: "Ashicore marketing automation paused",
    fields: [{ label: "Reason", value: args.reason }],
    idempotencyKey: `marketing-delivery-failure:${args.experimentId}:${args.activityId ?? "sync"}`,
  });
}

async function processCandidate(args: {
  orgId: string;
  experiment: ActiveExperiment;
  contactId: string;
  leaseId: string;
  now: Date;
}) {
  const candidate = await loadCandidate(args.orgId, args.contactId);
  if (!candidate) {
    await markContact({
      orgId: args.orgId,
      experimentId: args.experiment.id,
      contactId: args.contactId,
      leaseId: args.leaseId,
      patch: { status: "skipped", reason: "Contact is missing, invalid, or suppressed." },
    });
    return "skipped" as const;
  }
  const recipientEmail = candidate.email;
  let activity = await withOrgContext(args.orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(customerActivities)
      .where(
        and(
          eq(customerActivities.marketingExperimentId, args.experiment.id),
          eq(customerActivities.marketingContactId, candidate.id),
        ),
      );
    return existing ?? null;
  });

  try {
    if (!activity) {
      const corpus = await assertMarketingCorpusReady();
      let draft = await generateMarketingDraft({
        company: candidate.company,
        recipient: candidate.name,
        evidence: candidate.evidence,
        ...args.experiment.config,
        corpus,
      });
      const verdicts = [
        await evaluateMarketingDraft({
          draft,
          company: candidate.company,
          evidence: candidate.evidence,
          allowedClaims: args.experiment.config.allowedClaims,
          corpus,
        }),
      ];
      if (verdicts[0]!.verdict === "rewrite") {
        draft = await generateMarketingDraft({
          company: candidate.company,
          recipient: candidate.name,
          evidence: candidate.evidence,
          ...args.experiment.config,
          corpus,
          rewriteFeedback: verdicts[0],
        });
        verdicts.push(
          await evaluateMarketingDraft({
            draft,
            company: candidate.company,
            evidence: candidate.evidence,
            allowedClaims: args.experiment.config.allowedClaims,
            corpus,
          }),
        );
      }
      if (verdicts.at(-1)!.verdict !== "pass") {
        await markContact({
          orgId: args.orgId,
          experimentId: args.experiment.id,
          contactId: args.contactId,
          leaseId: args.leaseId,
          patch: { status: "skipped", reason: verdicts.at(-1)!.reasons.join(" ") },
        });
        return "skipped" as const;
      }

      const body = `${draft.body}${complianceFooter()}`;
      const metadata: MarketingActivityMetadata = {
        version: "v1",
        deliveryStatus: "processing",
        evidence: candidate.evidence,
        subject: draft.subject,
        generatedBody: draft.body,
        finalBody: body,
        evaluatorVerdicts: verdicts,
        model: marketingModelName(),
        promptVersion: MARKETING_PROMPT_VERSION,
        corpusVersion: corpus.version,
      };
      activity = await withOrgContext(args.orgId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(customerActivities)
          .where(
            and(
              eq(customerActivities.marketingExperimentId, args.experiment.id),
              eq(customerActivities.marketingContactId, candidate.id),
            ),
          );
        if (existing) return existing;
        const [created] = await tx
          .insert(customerActivities)
          .values({
            organizationId: args.orgId,
            customerId: candidate.customerId,
            type: "email",
            occurredAt: args.now,
            title: draft.subject,
            body,
            createdByUserId: args.experiment.createdByUserId,
            createdByName: "Ashicore marketing automation",
            marketingExperimentId: args.experiment.id,
            marketingContactId: candidate.id,
            marketingMetadata: metadata,
          })
          .returning();
        await tx.insert(customerActivityAttendees).values({
          organizationId: args.orgId,
          customerId: candidate.customerId,
          activityId: created!.id,
          contactId: candidate.id,
          contactName: candidate.name,
        });
        return created!;
      }, { userId: args.experiment.createdByUserId });
    }

    if (!activity) throw new DomainError("Marketing activity was not created.", 500);

    if (activity.marketingMetadata?.deliveryStatus === "sent") {
      await markContact({
        orgId: args.orgId,
        experimentId: args.experiment.id,
        contactId: args.contactId,
        leaseId: args.leaseId,
        patch: {
          status: "sent",
          activityId: activity.id,
          sentAt: activity.occurredAt.toISOString(),
          reason: null,
        },
      });
      return "sent" as const;
    }

    const deliveryMetadata = activity.marketingMetadata;
    if (
      !deliveryMetadata ||
      !["processing", "failed"].includes(deliveryMetadata.deliveryStatus)
    ) {
      throw new DomainError("Marketing activity has no retryable delivery evidence.", 409);
    }
    if (
      !(await leaseIsSendable({
        orgId: args.orgId,
        experimentId: args.experiment.id,
        contactId: args.contactId,
        leaseId: args.leaseId,
        now: new Date(),
      }))
    ) {
      return "skipped" as const;
    }

    let sent: Awaited<ReturnType<typeof sendGmailMessage>>;
    if (
      !(await contactCanReceiveMarketing(
        args.orgId,
        candidate.id,
        recipientEmail,
      ))
    ) {
      await markContact({
        orgId: args.orgId,
        experimentId: args.experiment.id,
        contactId: args.contactId,
        leaseId: args.leaseId,
        patch: { status: "skipped", reason: "Contact is no longer eligible for outreach." },
      });
      return "skipped" as const;
    }
    try {
      sent = await sendGmailMessage({
        orgId: args.orgId,
        to: recipientEmail,
        subject: deliveryMetadata.subject,
        text: deliveryMetadata.finalBody,
        idempotencyKey: `marketing:${args.experiment.id}:${candidate.id}:initial`,
      });
      await withOrgContext(args.orgId, (tx) =>
        tx
          .update(customerActivities)
          .set({
            marketingMetadata: {
              ...deliveryMetadata,
              deliveryStatus: "sent",
              gmailMessageId: sent.id,
              gmailRfcMessageId: sent.rfcMessageId,
              gmailThreadId: sent.threadId,
            },
            updatedAt: new Date(),
          })
          .where(eq(customerActivities.id, activity.id)),
        { userId: args.experiment.createdByUserId },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Gmail delivery failed.";
      await pauseForDeliveryFailure({
        orgId: args.orgId,
        experimentId: args.experiment.id,
        reason,
        activityId: activity.id,
        metadata: deliveryMetadata,
      });
      await markContact({
        orgId: args.orgId,
        experimentId: args.experiment.id,
        contactId: args.contactId,
        leaseId: args.leaseId,
        patch: { status: "pending", activityId: activity.id, reason },
      });
      return "skipped" as const;
    }
    const sentAt = args.now.toISOString();
    await markContact({
      orgId: args.orgId,
      experimentId: args.experiment.id,
      contactId: args.contactId,
      leaseId: args.leaseId,
      patch: { status: "sent", activityId: activity.id, sentAt, reason: null },
      lastSentAt: sentAt,
    });
    return "sent" as const;
  } catch (error) {
    await markContact({
      orgId: args.orgId,
      experimentId: args.experiment.id,
      contactId: args.contactId,
      leaseId: args.leaseId,
      patch: {
        status: "skipped",
        reason: error instanceof Error ? error.message : "Marketing generation failed.",
      },
    });
    return "skipped" as const;
  }
}

async function syncReplies(orgId: string) {
  const batch = await readNewGmailMessages(orgId);
  if (batch.messages.length === 0) {
    if (batch.historyId) await acknowledgeGmailHistory(orgId, batch.historyId);
    return 0;
  }
  const activities = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(customerActivities)
      .where(isNotNull(customerActivities.marketingExperimentId)),
  );
  let processed = 0;
  for (const message of batch.messages) {
    const activity = activities.find(
      (row) => row.marketingMetadata?.gmailThreadId === message.threadId,
    );
    if (
      !activity?.marketingExperimentId ||
      !activity.marketingContactId ||
      !activity.marketingMetadata
    ) continue;
    if (
      activity.marketingMetadata.replyMessageId === message.messageId ||
      activity.marketingMetadata.replyMessageIds?.includes(message.messageId)
    ) continue;
    const classification = await classifyMarketingReply(message);
    const isBounce =
      classification.outcome === "automated" &&
      /mailer-daemon|delivery status notification|undeliverable/i.test(
        `${message.from}\n${message.subject}\n${message.text}`,
      );
    const status = isBounce ? "bounced" : "replied";
    const updatedMetadata = {
      ...activity.marketingMetadata,
      replyMessageId: message.messageId,
      replyMessageIds: [
        ...(activity.marketingMetadata.replyMessageIds ?? []),
        message.messageId,
      ],
      replyOutcome: classification.outcome,
    };
    await withOrgContext(orgId, async (tx) => {
      await tx
        .update(customerActivities)
        .set({ marketingMetadata: updatedMetadata, updatedAt: new Date() })
        .where(eq(customerActivities.id, activity.id));
      if (["opt_out", "complaint"].includes(classification.outcome)) {
        await tx
          .update(customerContacts)
          .set({
            outreachSuppressedAt: new Date(),
            outreachSuppressionReason: classification.outcome,
            updatedAt: new Date(),
          })
          .where(eq(customerContacts.id, activity.marketingContactId!));
      }
    });
    await markContact({
      orgId,
      experimentId: activity.marketingExperimentId,
      contactId: activity.marketingContactId,
      patch: {
        status,
        outcome: classification.outcome,
        reason: classification.reason,
      },
    });
    if (["positive", "unknown"].includes(classification.outcome)) {
      await sendFounderAlert({
        kind: "marketing_reply",
        subject: `Ashicore outreach reply: ${classification.outcome}`,
        fields: [
          { label: "From", value: message.from },
          { label: "Subject", value: message.subject },
          { label: "Classification", value: classification.outcome },
          { label: "Reply", value: message.text.slice(0, 2_000) },
        ],
        idempotencyKey: `marketing-reply:${message.messageId}`,
      });
    }
    if (classification.outcome === "complaint") {
      await withOrgContext(orgId, (tx) =>
        tx
          .update(marketingExperiments)
          .set({ status: "paused", updatedAt: new Date() })
          .where(
            and(
              eq(marketingExperiments.id, activity.marketingExperimentId!),
              eq(marketingExperiments.status, "active"),
            ),
          ),
      );
    }
    activity.marketingMetadata = updatedMetadata;
    processed += 1;
  }
  if (batch.historyId) await acknowledgeGmailHistory(orgId, batch.historyId);
  return processed;
}

async function sendDueFollowUps(args: {
  orgId: string;
  experiment: ActiveExperiment;
  now: Date;
  timeZone: string;
}) {
  const leaseId = randomUUID();
  const leaseExpiresAt = new Date(args.now.getTime() + PROCESSING_LEASE_MS).toISOString();
  const due = await withOrgContext(args.orgId, async (tx) => {
    const [row] = await tx
      .select({ state: marketingExperiments.state, status: marketingExperiments.status })
      .from(marketingExperiments)
      .where(eq(marketingExperiments.id, args.experiment.id))
      .for("update");
    if (!row || row.status !== "active") return [];
    const state = marketingExperimentStateSchema.parse(row.state);
    const limit = Math.max(
      0,
      dailyAllowance(state, args.now, args.timeZone) - reservedCount(state, args.now),
    );
    const claimed = Object.entries(state.contactProgress)
      .filter(([, progress]) =>
        progress.status === "sent" &&
        progress.outcome == null &&
        progress.followUpSentAt == null &&
        progress.sentAt != null &&
        args.now.getTime() - new Date(progress.sentAt).getTime() >= FOLLOW_UP_AFTER_MS &&
        (!progress.followUpLeaseExpiresAt ||
          new Date(progress.followUpLeaseExpiresAt).getTime() <= args.now.getTime()),
      )
      .slice(0, limit);
    for (const [contactId, progress] of claimed) {
      state.contactProgress[contactId] = {
        ...progress,
        followUpLeaseId: leaseId,
        followUpLeaseExpiresAt: leaseExpiresAt,
      };
    }
    await tx
      .update(marketingExperiments)
      .set({ state, updatedAt: new Date() })
      .where(eq(marketingExperiments.id, args.experiment.id));
    return claimed;
  });
  const corpus = await assertMarketingCorpusReady();
  let sentTotal = 0;
  for (const [contactId, progress] of due) {
    const candidate = await loadCandidate(args.orgId, contactId);
    if (!candidate || !progress.activityId) continue;
    const recipientEmail = candidate.email;
    const activity = await withOrgContext(args.orgId, async (tx) => {
      const [row] = await tx
        .select()
        .from(customerActivities)
        .where(eq(customerActivities.id, progress.activityId!));
      return row;
    });
    const metadata = activity?.marketingMetadata;
    if (!metadata?.gmailThreadId || !metadata.gmailRfcMessageId) continue;
    const draft = await generateMarketingFollowUp({
      recipient: candidate.name,
      originalSubject: metadata.subject,
      originalBody: metadata.finalBody,
      cta: args.experiment.config.cta,
      corpus,
    });
    const verdict = await evaluateMarketingDraft({
      draft,
      company: candidate.company,
      evidence: [...candidate.evidence, metadata.finalBody],
      allowedClaims: args.experiment.config.allowedClaims,
      corpus,
    });
    if (verdict.verdict !== "pass") continue;
    const active = await loadActiveExperiment(args.orgId);
    if (!active || active.id !== args.experiment.id) break;
    const activeProgress = marketingExperimentStateSchema.parse(active.state).contactProgress[contactId];
    if (
      activeProgress?.followUpLeaseId !== leaseId ||
      !activeProgress.followUpLeaseExpiresAt ||
      new Date(activeProgress.followUpLeaseExpiresAt).getTime() <= Date.now()
    ) continue;
    if (
      !(await contactCanReceiveMarketing(args.orgId, contactId, recipientEmail))
    ) {
      await markContact({
        orgId: args.orgId,
        experimentId: args.experiment.id,
        contactId,
        patch: { status: "skipped", reason: "Contact is no longer eligible for outreach." },
      });
      continue;
    }
    const body = `${draft.body}${complianceFooter()}`;
    let sent: Awaited<ReturnType<typeof sendGmailMessage>>;
    try {
      sent = await sendGmailMessage({
        orgId: args.orgId,
        to: recipientEmail,
        subject: draft.subject,
        text: body,
        idempotencyKey: `marketing:${args.experiment.id}:${contactId}:follow-up`,
        threadId: metadata.gmailThreadId,
        inReplyTo: metadata.gmailRfcMessageId,
      });
    } catch (error) {
      await pauseForDeliveryFailure({
        orgId: args.orgId,
        experimentId: args.experiment.id,
        reason: error instanceof Error ? error.message : "Gmail follow-up failed.",
      });
      break;
    }
    const followUpSentAt = args.now.toISOString();
    await withOrgContext(args.orgId, (tx) =>
      tx
        .update(customerActivities)
        .set({
          marketingMetadata: {
            ...metadata,
            followUpMessageId: sent.id,
            followUpRfcMessageId: sent.rfcMessageId,
            followUpSubject: draft.subject,
            followUpBody: body,
            followUpEvaluatorVerdict: verdict,
          },
          updatedAt: new Date(),
        })
        .where(eq(customerActivities.id, activity.id)),
    );
    await markContact({
      orgId: args.orgId,
      experimentId: args.experiment.id,
      contactId,
      patch: { followUpSentAt, followUpLeaseId: null, followUpLeaseExpiresAt: null },
      lastSentAt: followUpSentAt,
    });
    sentTotal += 1;
  }
  return sentTotal;
}

async function maybeAutoPauseForBounces(orgId: string, experimentId: string) {
  const experiment = await loadActiveExperiment(orgId);
  if (!experiment || experiment.id !== experimentId) return false;
  const state = marketingExperimentStateSchema.parse(experiment.state);
  const firstTen = progressValues(state)
    .filter((row) => ["sent", "bounced", "replied"].includes(row.status))
    .slice(0, 10);
  if (firstTen.filter((row) => row.status === "bounced").length < 2) return false;
  await withOrgContext(orgId, (tx) =>
    tx
      .update(marketingExperiments)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(marketingExperiments.id, experimentId)),
  );
  return true;
}

async function maybeCompleteExperiment(orgId: string, experimentId: string, now: Date) {
  const experiment = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select()
      .from(marketingExperiments)
      .where(eq(marketingExperiments.id, experimentId));
    return row ?? null;
  });
  if (!experiment || experiment.status !== "active") return false;
  const state = marketingExperimentStateSchema.parse(experiment.state);
  if (progressValues(state).some((row) => ["pending", "processing"].includes(row.status))) {
    return false;
  }
  if (
    state.lastSentAt &&
    now.getTime() - new Date(state.lastSentAt).getTime() < EVALUATION_DELAY_MS
  ) {
    return false;
  }
  const values = progressValues(state);
  const sent = values.filter((row) => ["sent", "bounced", "replied"].includes(row.status)).length;
  const bounced = values.filter((row) => row.status === "bounced").length;
  const delivered = Math.max(0, sent - bounced);
  const positiveReplies = values.filter((row) => row.outcome === "positive").length;
  const metrics = {
    sent,
    delivered,
    bounced,
    positiveReplies,
    validDeliveryRate: sent === 0 ? 0 : delivered / sent,
    positiveReplyRate: delivered === 0 ? 0 : positiveReplies / delivered,
  };
  const analysis = await analyzeMarketingExperiment({
    hypothesis: experiment.config.hypothesis,
    segment: experiment.config.segment,
    painAngle: experiment.config.painAngle,
    metrics,
  });
  const result = { ...metrics, ...analysis };
  await withOrgContext(orgId, (tx) =>
    tx
      .update(marketingExperiments)
      .set({ status: "completed", result, evaluateAt: now, updatedAt: now })
      .where(eq(marketingExperiments.id, experimentId)),
  );
  await sendFounderAlert({
    kind: "marketing_experiment",
    subject: "Ashicore marketing experiment completed",
    fields: [
      { label: "Hypothesis", value: experiment.config.hypothesis },
      { label: "Delivered", value: delivered },
      { label: "Positive replies", value: positiveReplies },
      { label: "Learning", value: analysis.learning },
      { label: "Proposed next change", value: analysis.nextChange },
    ],
    idempotencyKey: `marketing-experiment-complete:${experiment.id}`,
  });
  return true;
}

export async function processMarketingTick(args: {
  orgId: string;
  now?: Date;
  timeZone?: string;
}) {
  const now = args.now ?? new Date();
  const timeZone = args.timeZone ?? await withOrgContext(args.orgId, async (tx) => {
    const [row] = await tx
      .select({ timeZone: organization.timeZone })
      .from(organization)
      .where(eq(organization.id, args.orgId));
    return row?.timeZone ?? "America/Denver";
  });
  let experiment = await loadActiveExperiment(args.orgId);

  let replies: number;
  try {
    replies = await syncReplies(args.orgId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Gmail reply sync failed.";
    if (experiment) {
      await pauseForDeliveryFailure({
        orgId: args.orgId,
        experimentId: experiment.id,
        reason,
      });
      return { status: "paused" as const, replies: 0, reason: "mailbox_failure" };
    }
    await sendFounderAlert({
      kind: "marketing_experiment",
      subject: "Ashicore marketing reply sync failed",
      fields: [{ label: "Reason", value: reason }],
      idempotencyKey: "marketing-reply-sync-failure",
    });
    return { status: "idle" as const, replies: 0, reason: "mailbox_failure" };
  }
  experiment = await loadActiveExperiment(args.orgId);
  if (!experiment) return { status: "idle" as const, replies };
  if (await maybeAutoPauseForBounces(args.orgId, experiment.id)) {
    return { status: "paused" as const, replies, reason: "bounce_guard" };
  }
  experiment = await loadActiveExperiment(args.orgId);
  if (!experiment) return { status: "paused" as const, replies };

  let followUps = 0;
  let sent = 0;
  if (await sendWindowOpen(now, timeZone)) {
    followUps = await sendDueFollowUps({
      orgId: args.orgId,
      experiment,
      now,
      timeZone,
    });
    const activeAfterFollowUps = await loadActiveExperiment(args.orgId);
    if (!activeAfterFollowUps) {
      return { status: "paused" as const, replies, followUps, sent };
    }
    experiment = activeAfterFollowUps;
    if (dailyAllowance(marketingExperimentStateSchema.parse(experiment.state), now, timeZone) > 0) {
      const { leaseId, claimed } = await claimPendingContacts({
        orgId: args.orgId,
        experiment,
        now,
        timeZone,
      });
      for (const contactId of claimed) {
        if (!(await loadActiveExperiment(args.orgId))) break;
        if (
          (await processCandidate({
            orgId: args.orgId,
            experiment,
            contactId,
            leaseId,
            now,
          })) === "sent"
        ) {
          sent += 1;
        }
      }
    }
  }
  const completed = await maybeCompleteExperiment(args.orgId, experiment.id, now);
  return {
    status: completed ? ("completed" as const) : ("active" as const),
    replies,
    followUps,
    sent,
  };
}
