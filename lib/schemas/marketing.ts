import { z } from "zod";

export const MARKETING_EXPERIMENT_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
] as const;

export const MARKETING_CONTACT_STATUSES = [
  "pending",
  "processing",
  "skipped",
  "sent",
  "bounced",
  "replied",
] as const;

export const MARKETING_REPLY_OUTCOMES = [
  "positive",
  "neutral",
  "negative",
  "opt_out",
  "complaint",
  "automated",
  "unknown",
] as const;

export const marketingExperimentConfigSchema = z.object({
  hypothesis: z.string().trim().min(1).max(2_000),
  segment: z.string().trim().min(1).max(1_000),
  painAngle: z.string().trim().min(1).max(1_000),
  cta: z.string().trim().min(1).max(500),
  allowedClaims: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  contactIds: z.array(z.string().uuid()).min(1).max(30),
});

export type MarketingExperimentConfig = z.infer<
  typeof marketingExperimentConfigSchema
>;

export const marketingContactProgressSchema = z.object({
  status: z.enum(MARKETING_CONTACT_STATUSES),
  processingLeaseId: z.string().uuid().nullable().default(null),
  processingLeaseExpiresAt: z.string().datetime().nullable().default(null),
  activityId: z.string().uuid().nullable().default(null),
  sentAt: z.string().datetime().nullable().default(null),
  followUpLeaseId: z.string().uuid().nullable().default(null),
  followUpLeaseExpiresAt: z.string().datetime().nullable().default(null),
  followUpSentAt: z.string().datetime().nullable().default(null),
  outcome: z.enum(MARKETING_REPLY_OUTCOMES).nullable().default(null),
  reason: z.string().nullable().default(null),
});

export type MarketingContactProgress = z.infer<
  typeof marketingContactProgressSchema
>;

export const marketingExperimentStateSchema = z.object({
  activatedAt: z.string().datetime().nullable().default(null),
  lastSentAt: z.string().datetime().nullable().default(null),
  canaryCompletedAt: z.string().datetime().nullable().default(null),
  contactProgress: z.record(z.string().uuid(), marketingContactProgressSchema),
});

export type MarketingExperimentState = z.infer<
  typeof marketingExperimentStateSchema
>;

export const marketingExperimentResultSchema = z.object({
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  bounced: z.number().int().nonnegative(),
  positiveReplies: z.number().int().nonnegative(),
  validDeliveryRate: z.number().min(0).max(1),
  positiveReplyRate: z.number().min(0).max(1),
  learning: z.string().nullable(),
  nextChange: z.string().nullable(),
});

export type MarketingExperimentResult = z.infer<
  typeof marketingExperimentResultSchema
>;

export const marketingExperimentCreateSchema = marketingExperimentConfigSchema;

export const marketingContactSuppressionSchema = z.object({
  suppressed: z.boolean(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const marketingEmailCorpusSchema = z.object({
  version: z.string().trim().min(1),
  blacklist: z.array(z.string().trim().min(1)).max(50).default([]),
  examples: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        situation: z.string().trim().min(1),
        subject: z.string().trim().min(1),
        body: z.string().trim().min(1),
      }),
    )
    .max(20),
});

export type MarketingEmailCorpus = z.infer<typeof marketingEmailCorpusSchema>;

export type MarketingActivityMetadata = {
  version: "v1";
  deliveryStatus: "processing" | "sent" | "failed";
  evidence: string[];
  subject: string;
  generatedBody: string;
  finalBody: string;
  evaluatorVerdicts: Array<{
    verdict: "pass" | "rewrite";
    reasons: string[];
    offendingPhrases: string[];
  }>;
  model: string;
  promptVersion: string;
  corpusVersion: string;
  gmailMessageId?: string;
  gmailRfcMessageId?: string;
  gmailThreadId?: string;
  followUpMessageId?: string;
  followUpRfcMessageId?: string;
  followUpSubject?: string;
  followUpBody?: string;
  followUpEvaluatorVerdict?: {
    verdict: "pass" | "rewrite";
    reasons: string[];
    offendingPhrases: string[];
  };
  replyMessageId?: string;
  replyMessageIds?: string[];
  replyOutcome?: (typeof MARKETING_REPLY_OUTCOMES)[number];
};
