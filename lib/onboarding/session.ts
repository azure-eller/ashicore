import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { onboardingSessions } from "@/lib/db/schema";
import {
  isBillingSelection,
  normalizeBillingSelection,
} from "@/lib/billing/plan-intent";
import type { Tx } from "@/lib/db/with-org-context";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { DomainError } from "@/lib/errors/domain-error";

const onboardingStatuses = [
  "org_created",
  "importing",
  "reviewing",
  "connecting",
  "completed",
  "skipped",
] as const;

const onboardingSteps = [
  "invite",
  "import",
  "extract",
  "review",
  "connect",
  "done",
] as const;

const billingSelectionSchema = z
  .unknown()
  .refine(isBillingSelection, "Select a billing plan from the catalog.")
  .transform(normalizeBillingSelection);

export const startOnboardingSessionSchema = z.object({
  selectedPlan: billingSelectionSchema.optional(),
  currentStep: z.enum(onboardingSteps).optional(),
});

export const patchOnboardingSessionSchema = z.object({
  selectedPlan: billingSelectionSchema.nullable().optional(),
  status: z.enum(onboardingStatuses).optional(),
  currentStep: z.enum(onboardingSteps).optional(),
  importSessionId: z.string().uuid().nullable().optional(),
  invitesDraft: z
    .array(
      z.object({
        email: z.string().email(),
        role: z.string().trim().min(1).max(64),
      }),
    )
    .nullable()
    .optional(),
});

type OnboardingSessionRow = typeof onboardingSessions.$inferSelect;

function serializeOnboardingSession(row: OnboardingSessionRow) {
  return {
    id: row.id,
    selectedPlan: row.selectedPlan,
    status: row.status,
    currentStep: row.currentStep,
    importSessionId: row.importSessionId,
    invitesDraft: row.invitesDraft,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getActiveOnboardingSessionInTx(tx: Tx) {
  const [session] = await tx
    .select()
    .from(onboardingSessions)
    .where(and(isNull(onboardingSessions.deletedAt), isNull(onboardingSessions.completedAt)))
    .limit(1);
  return session ?? null;
}

export async function getCurrentOnboardingSession() {
  return withAuthedOrgContext(async (tx) => {
    const session = await getActiveOnboardingSessionInTx(tx);
    return session ? serializeOnboardingSession(session) : null;
  });
}

export async function startOrResumeOnboardingSession(
  input: z.infer<typeof startOnboardingSessionSchema>,
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const existing = await getActiveOnboardingSessionInTx(tx);
    if (existing) {
      const [updated] = await tx
        .update(onboardingSessions)
        .set({
          selectedPlan: input.selectedPlan ?? existing.selectedPlan,
          currentStep: input.currentStep ?? existing.currentStep,
          updatedAt: new Date(),
        })
        .where(eq(onboardingSessions.id, existing.id))
        .returning();
      return serializeOnboardingSession(updated);
    }

    const [created] = await tx
      .insert(onboardingSessions)
      .values({
        organizationId: orgId,
        createdByUserId: userId,
        selectedPlan: input.selectedPlan ?? null,
        currentStep: input.currentStep ?? "invite",
      })
      .returning();
    return serializeOnboardingSession(created);
  });
}

export async function updateOnboardingSession(
  input: z.infer<typeof patchOnboardingSessionSchema>,
) {
  return withAuthedOrgContext(async (tx) => {
    const existing = await getActiveOnboardingSessionInTx(tx);
    if (!existing) {
      throw new DomainError("Onboarding session not found.", 404);
    }

    const status = input.status ?? existing.status;
    const completedAt =
      status === "completed" || status === "skipped"
        ? existing.completedAt ?? new Date()
        : existing.completedAt;

    const [updated] = await tx
      .update(onboardingSessions)
      .set({
        selectedPlan:
          input.selectedPlan === undefined ? existing.selectedPlan : input.selectedPlan,
        status,
        currentStep: input.currentStep ?? existing.currentStep,
        importSessionId:
          input.importSessionId === undefined
            ? existing.importSessionId
            : input.importSessionId,
        invitesDraft:
          input.invitesDraft === undefined ? existing.invitesDraft : input.invitesDraft,
        completedAt,
        updatedAt: new Date(),
      })
      .where(eq(onboardingSessions.id, existing.id))
      .returning();

    return serializeOnboardingSession(updated);
  });
}

export async function attachImportSessionToCurrentOnboarding(importSessionId: string) {
  return withAuthedOrgContext(async (tx) => {
    const existing = await getActiveOnboardingSessionInTx(tx);
    if (!existing) return null;

    const [updated] = await tx
      .update(onboardingSessions)
      .set({
        importSessionId,
        status: "importing",
        currentStep: "extract",
        updatedAt: new Date(),
      })
      .where(eq(onboardingSessions.id, existing.id))
      .returning();
    return serializeOnboardingSession(updated);
  });
}

export async function updateCurrentOnboardingProgress(input: {
  status?: (typeof onboardingStatuses)[number];
  currentStep?: (typeof onboardingSteps)[number];
}) {
  return withAuthedOrgContext(async (tx) => {
    const existing = await getActiveOnboardingSessionInTx(tx);
    if (!existing) return null;

    const [updated] = await tx
      .update(onboardingSessions)
      .set({
        status: input.status ?? existing.status,
        currentStep: input.currentStep ?? existing.currentStep,
        updatedAt: new Date(),
      })
      .where(eq(onboardingSessions.id, existing.id))
      .returning();
    return serializeOnboardingSession(updated);
  });
}
