import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/with-org-context";
import { onboardingSessions } from "@/lib/db/schema";
import { organization } from "@/lib/db/schema/auth";
import { FREE_SKU_LIMIT } from "@/lib/billing/types";

// The SKU ceiling that applies to an in-progress import preview.
//
// Payment is collected at the very end of onboarding, so during the flow the org
// is still `plan="free"` even for a paid-intent user. We therefore size the limit
// off *intent*, not the org's current plan:
//   - already-paid org (plan="core")      → no limit
//   - paid intent (selectedPlan="paid")   → no limit (commit is gated behind payment)
//   - everything else (free)              → FREE_SKU_LIMIT
//
// The hard guarantee still lives in the inventory kernel at commit time: a free org
// can never commit past FREE_SKU_LIMIT, and a paid-intent import only commits once
// the org is genuinely `core` (after the final Stripe payment). This limit just
// drives the review-step UI (the upsell / unselect prompt).
//
// `ONBOARDING_IMPORT_SKU_LIMIT` remains an explicit override for ops/tests.
export async function getSkuImportLimitInTx(tx: Tx, orgId: string): Promise<number | null> {
  const raw = process.env.ONBOARDING_IMPORT_SKU_LIMIT;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  }

  const [org] = await tx
    .select({ plan: organization.plan })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (org?.plan === "core") return null;

  const [session] = await tx
    .select({ selectedPlan: onboardingSessions.selectedPlan })
    .from(onboardingSessions)
    .where(
      and(
        eq(onboardingSessions.organizationId, orgId),
        isNull(onboardingSessions.completedAt),
        isNull(onboardingSessions.deletedAt),
      ),
    )
    .limit(1);
  if (session?.selectedPlan === "paid") return null;

  return FREE_SKU_LIMIT;
}
