import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { deleteLocalAttachment } from "@/lib/attachments/local-file-storage";
import { assertOnboardingImportAccess } from "@/lib/onboarding/import/access";
import {
  approveImportSession,
  getImportSession,
  serializeImportSession,
} from "@/lib/onboarding/import/sessions";
import { updateCurrentOnboardingProgress } from "@/lib/onboarding/session";
import { getBillingStateByOrgId } from "@/lib/billing/dal";
import { syncOrgBillingFromStripe } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Paid path: commit the staged import once the org has actually paid. Reached when
// the user returns from Stripe checkout at the end of onboarding.
export const POST = apiHandler(async (request: Request, context: unknown) => {
  const member = await assertOnboardingImportAccess(request.headers);
  const { id } = await (context as RouteContext).params;
  const orgId = member.orgId;

  // Idempotent: a refresh / double-submit after a successful commit just succeeds.
  const existing = await getImportSession(id);
  if (existing.session.committedAt) {
    return NextResponse.json({
      session: serializeImportSession(existing.session),
      commitSummary: existing.session.commitSummary,
      committed: true,
    });
  }

  // Require a genuinely paid org before the (unlimited) commit. The Stripe webhook
  // normally flips the plan; pull directly in case the redirect beat the webhook.
  let plan = (await getBillingStateByOrgId(orgId))?.plan ?? null;
  if (plan !== "core") {
    try {
      plan = (await syncOrgBillingFromStripe(orgId))?.plan ?? plan;
    } catch {
      // Stripe unreachable/unconfigured — fall through to the 402 below.
    }
  }
  if (plan !== "core") {
    return jsonError(
      "Payment isn't confirmed yet. If you just paid, give it a moment and try again.",
      402,
    );
  }

  const result = await approveImportSession(id, {});
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await deletePrivateBlobsIfConfigured(result.storageKeysToDelete);
  } else {
    await Promise.all(
      result.storageKeysToDelete.map((key) =>
        deleteLocalAttachment(`local://${key}`).catch(() => undefined),
      ),
    );
  }
  await updateCurrentOnboardingProgress({ status: "connecting", currentStep: "connect" });
  return NextResponse.json({
    session: serializeImportSession(result.session),
    commitSummary: result.commitSummary,
    committed: true,
  });
});
