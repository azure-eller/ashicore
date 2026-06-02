import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { deleteLocalAttachment } from "@/lib/attachments/local-file-storage";
import { assertOnboardingImportAccess } from "@/lib/onboarding/import/access";
import {
  cancelImportSession,
  getImportSession,
  patchImportSessionSchema,
  serializeImportSession,
  updateImportSessionPackage,
} from "@/lib/onboarding/import/sessions";
import { updateCurrentOnboardingProgress } from "@/lib/onboarding/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_request: Request, context: unknown) => {
  await assertOnboardingImportAccess(_request.headers);
  const { id } = await (context as RouteContext).params;
  const result = await getImportSession(id);
  return NextResponse.json({
    session: serializeImportSession(result.session),
    files: result.files,
    preview: result.preview,
    reviewPackage: result.reviewPackage,
  });
});

export const PATCH = apiHandler(async (request: Request, context: unknown) => {
  await assertOnboardingImportAccess(request.headers);
  const { id } = await (context as RouteContext).params;
  const data = await parseJsonBody(request, patchImportSessionSchema);
  const result = await updateImportSessionPackage(id, data);
  await updateCurrentOnboardingProgress({ status: "reviewing", currentStep: "review" });
  return NextResponse.json({
    session: serializeImportSession(result.session),
    preview: result.preview,
    reviewPackage: result.reviewPackage,
  });
});

export const DELETE = apiHandler(async (request: Request, context: unknown) => {
  await assertOnboardingImportAccess(request.headers);
  const { id } = await (context as RouteContext).params;
  const result = await cancelImportSession(id);
  if (!result) {
    return NextResponse.json({ error: "Import session not found." }, { status: 404 });
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await deletePrivateBlobsIfConfigured(result.storageKeys);
  } else {
    await Promise.all(
      result.storageKeys.map((key) => deleteLocalAttachment(`local://${key}`).catch(() => undefined)),
    );
  }
  return NextResponse.json({ session: result.session });
});
