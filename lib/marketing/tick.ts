import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
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
import { readNewGmailMessages, sendGmailMessage } from "./gmail";
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
    (row) => row.sentAt && localDateKey(new Date(row.sentAt), timeZone) === today,
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
  limit: number;
  now: Date;
}) {
  const leaseId = randomUUID();
  const expiresAt = new Date(args.now.getTime() + PROCESSING_LEASE_MS).toISOString();
  const claimed: string[] = [];
  await persistState(args.orgId, args.experiment.id, (state) => {
    for (const contactId of args.experiment.config.contactIds) {
      if (claimed.length >= args.limit) break;
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
    return state;
  });
  return { leaseId, claimed };
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

  try {
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
    const activity = await withOrgContext(args.orgId, async (tx) => {
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

    let sent: Awaited<ReturnType<typeof sendGmailMessage>>;
    try {
      sent = await sendGmailMessage({
        orgId: args.orgId,
        to: recipientEmail,
        subject: draft.subject,
        text: body,
        idempotencyKey: `marketing:${args.experiment.id}:${candidate.id}:initial`,
      });
      await withOrgContext(args.orgId, (tx) =>
        tx
          .update(customerActivities)
          .set({
            marketingMetadata: {
              ...metadata,
              deliveryStatus: "sent",
              gmailMessageId: sent.id,
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
        metadata,
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

async function syncReplies(orgId: string, experiment: ActiveExperiment) {
  const inbound = await readNewGmailMessages(orgId);
  if (inbound.length === 0) return 0;
  const activities = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(customerActivities)
      .where(eq(customerActivities.marketingExperimentId, experiment.id)),
  );
  let processed = 0;
  for (const message of inbound) {
    const activity = activities.find(
      (row) => row.marketingMetadata?.gmailThreadId === message.threadId,
    );
    if (!activity?.marketingContactId || !activity.marketingMetadata) continue;
    if (activity.marketingMetadata.replyMessageId === message.messageId) continue;
    const classification = await classifyMarketingReply(message);
    const isBounce =
      classification.outcome === "automated" &&
      /mailer-daemon|delivery status notification|undeliverable/i.test(
        `${message.from}\n${message.subject}\n${message.text}`,
      );
    const status = isBounce ? "bounced" : "replied";
    await withOrgContext(orgId, async (tx) => {
      await tx
        .update(customerActivities)
        .set({
          marketingMetadata: {
            ...activity.marketingMetadata!,
            replyMessageId: message.messageId,
            replyOutcome: classification.outcome,
          },
          updatedAt: new Date(),
        })
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
      experimentId: experiment.id,
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
          .where(eq(marketingExperiments.id, experiment.id)),
      );
    }
    processed += 1;
  }
  return processed;
}

async function sendDueFollowUps(args: {
  orgId: string;
  experiment: ActiveExperiment;
  now: Date;
  limit: number;
}) {
  const state = marketingExperimentStateSchema.parse(args.experiment.state);
  const due = Object.entries(state.contactProgress)
    .filter(([, row]) =>
      row.status === "sent" &&
      row.outcome == null &&
      row.followUpSentAt == null &&
      row.sentAt != null &&
      args.now.getTime() - new Date(row.sentAt).getTime() >= FOLLOW_UP_AFTER_MS,
    )
    .slice(0, args.limit);
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
    if (!metadata?.gmailThreadId || !metadata.gmailMessageId) continue;
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
    let sent: Awaited<ReturnType<typeof sendGmailMessage>>;
    try {
      sent = await sendGmailMessage({
        orgId: args.orgId,
        to: recipientEmail,
        subject: draft.subject,
        text: draft.body,
        idempotencyKey: `marketing:${args.experiment.id}:${contactId}:follow-up`,
        threadId: metadata.gmailThreadId,
        inReplyTo: metadata.gmailMessageId,
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
          marketingMetadata: { ...metadata, followUpMessageId: sent.id },
          updatedAt: new Date(),
        })
        .where(eq(customerActivities.id, activity.id)),
    );
    await markContact({
      orgId: args.orgId,
      experimentId: args.experiment.id,
      contactId,
      patch: { followUpSentAt },
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
  if (!experiment) return { status: "idle" as const };

  let replies: number;
  try {
    replies = await syncReplies(args.orgId, experiment);
  } catch (error) {
    await pauseForDeliveryFailure({
      orgId: args.orgId,
      experimentId: experiment.id,
      reason: error instanceof Error ? error.message : "Gmail reply sync failed.",
    });
    return { status: "paused" as const, replies: 0, reason: "mailbox_failure" };
  }
  if (await maybeAutoPauseForBounces(args.orgId, experiment.id)) {
    return { status: "paused" as const, replies, reason: "bounce_guard" };
  }
  experiment = await loadActiveExperiment(args.orgId);
  if (!experiment) return { status: "paused" as const, replies };

  let followUps = 0;
  let sent = 0;
  if (await sendWindowOpen(now, timeZone)) {
    const initialState = marketingExperimentStateSchema.parse(experiment.state);
    const allowance = dailyAllowance(initialState, now, timeZone);
    followUps = await sendDueFollowUps({
      orgId: args.orgId,
      experiment,
      now,
      limit: allowance,
    });
    experiment = (await loadActiveExperiment(args.orgId))!;
    const remaining = Math.max(
      0,
      dailyAllowance(marketingExperimentStateSchema.parse(experiment.state), now, timeZone) -
        followUps,
    );
    if (remaining > 0) {
      const { leaseId, claimed } = await claimPendingContacts({
        orgId: args.orgId,
        experiment,
        limit: remaining,
        now,
      });
      for (const contactId of claimed) {
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
