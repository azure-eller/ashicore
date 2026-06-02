import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonCreated } from "@/lib/api/responses";
import { DomainError } from "@/lib/errors/domain-error";
import {
  MAX_PRIVATE_FILE_BYTES,
  sanitizeBlobPathPart,
  uploadPrivateFile,
  type PrivateFormFile,
} from "@/lib/blob-storage";
import {
  canUseLocalAttachmentStorage,
  deleteLocalAttachment,
  writeLocalAttachment,
} from "@/lib/attachments/local-file-storage";
import { assertOnboardingImportAccess } from "@/lib/onboarding/import/access";
import {
  addImportFiles,
  createImportSession,
  serializeImportSession,
} from "@/lib/onboarding/import/sessions";
import { attachImportSessionToCurrentOnboarding } from "@/lib/onboarding/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMPORT_FILES = 12;
const MAX_IMPORT_TOTAL_BYTES = 100 * 1024 * 1024;

function isPrivateFormFile(file: PrivateFormFile | null): file is PrivateFormFile {
  return file != null;
}

function formFileToPrivateFile(value: FormDataEntryValue): PrivateFormFile | null {
  if (!(value instanceof File)) return null;
  if (value.size <= 0) return null;
  if (value.size > MAX_PRIVATE_FILE_BYTES) {
    throw new DomainError("Each import file must be 50 MB or smaller.");
  }
  return {
    file: value,
    filename: value.name || "upload",
    contentType: value.type || "application/octet-stream",
    sizeBytes: value.size,
  };
}

export const POST = apiHandler(async (request) => {
  await assertOnboardingImportAccess(request.headers);
  const useBlobStorage = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  if (!useBlobStorage && !canUseLocalAttachmentStorage()) {
    throw new DomainError("Private file storage is not configured.", 503);
  }

  const formData = await request.formData();
  const files = formData.getAll("file").map(formFileToPrivateFile).filter(isPrivateFormFile);

  if (files.length === 0) {
    return NextResponse.json({ error: "At least one file is required." }, { status: 400 });
  }
  if (files.length > MAX_IMPORT_FILES) {
    return NextResponse.json(
      { error: `Import sessions support up to ${MAX_IMPORT_FILES} files.` },
      { status: 400 },
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "Import sessions support up to 100 MB total." },
      { status: 400 },
    );
  }

  const session = await createImportSession();
  const uploads = await Promise.all(
    files.map(async (file) => {
      if (useBlobStorage) {
        return uploadPrivateFile(file, ["onboarding-imports", session.id]);
      }

      const storageKey = [
        "onboarding-imports",
        session.id,
        `${crypto.randomUUID()}-${sanitizeBlobPathPart(file.filename)}`,
      ].join("/");
      return {
        ...file,
        storageKey,
        blobUrl: await writeLocalAttachment(storageKey, file.file),
      };
    }),
  );

  try {
    await addImportFiles(session.id, uploads);
    await attachImportSessionToCurrentOnboarding(session.id);
  } catch (error) {
    if (!useBlobStorage) {
      await Promise.all(
        uploads.map((upload) => deleteLocalAttachment(upload.blobUrl).catch(() => undefined)),
      );
    }
    throw error;
  }

  return jsonCreated({
    session: serializeImportSession(session),
    files: uploads.map((upload) => ({
      filename: upload.filename,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
    })),
  });
});
