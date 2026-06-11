import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { parseJsonBody } from "@/lib/api/request-body";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { deleteLocalAttachment } from "@/lib/attachments/local-file-storage";
import { assertOnboardingImportAccess } from "@/lib/onboarding/import/access";
import {
  approveImportSession,
  approveImportSessionSchema,
  serializeImportSession,
} from "@/lib/onboarding/import/sessions";
import {
  getCurrentOnboardingSession,
  updateCurrentOnboardingProgress,
} from "@/lib/onboarding/session";
import { getBillingStateByOrgId } from "@/lib/billing/dal";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiHandler(async (request: Request, context: unknown) => {
  const member = await assertOnboardingImportAccess(request.headers);
  const { id } = await (context as RouteContext).params;
  const data = await parseJsonBody(request, approveImportSessionSchema);

  // Paid intent commits only after payment, via the finalize route. Refuse the
  // direct commit here unless the org is genuinely paid (so nothing is written
  // to the DB before the user has paid).
  const onboarding = await getCurrentOnboardingSession();
  if (onboarding?.selectedPlan === "paid") {
    const billing = await getBillingStateByOrgId(member.orgId);
    if (billing?.plan !== "core") {
      return jsonError("Complete payment to import your data.", 402);
    }
  }

  // Free intent (or already-paid org): commit now. The inventory kernel enforces
  // the free SKU ceiling, so a free org can never commit past the limit.
  const result = await approveImportSession(id, data);
  if (env.BLOB_READ_WRITE_TOKEN) {
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
    preview: result.preview,
    commitSummary: result.commitSummary,
    committed: true,
  });
});
