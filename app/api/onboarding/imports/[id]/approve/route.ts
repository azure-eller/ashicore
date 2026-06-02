import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { deleteLocalAttachment } from "@/lib/attachments/local-file-storage";
import { assertOnboardingImportAccess } from "@/lib/onboarding/import/access";
import {
  approveImportSession,
  approveImportSessionSchema,
  serializeImportSession,
} from "@/lib/onboarding/import/sessions";
import { updateCurrentOnboardingProgress } from "@/lib/onboarding/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiHandler(async (request: Request, context: unknown) => {
  await assertOnboardingImportAccess(request.headers);
  const { id } = await (context as RouteContext).params;
  const data = await parseJsonBody(request, approveImportSessionSchema);
  const result = await approveImportSession(id, data);
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
    preview: result.preview,
    commitSummary: result.commitSummary,
  });
});
