import { del, get, put, type GetBlobResult } from "@vercel/blob";
import { DomainError } from "@/lib/errors/domain-error";

type PrivateBlobRead = Extract<GetBlobResult, { statusCode: 200 }>;

export const MAX_PRIVATE_FILE_BYTES = 50 * 1024 * 1024;
const PRIVATE_BLOB_READ_ATTEMPTS = 3;
const PRIVATE_BLOB_READ_RETRY_MS = 250;
const DEFAULT_PRIVATE_FILE_CONTENT_TYPE = "application/octet-stream";

export type PrivateFormFile = {
  file: File;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type PrivateFileUpload = PrivateFormFile & {
  storageKey: string;
  blobUrl: string;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertPrivateBlobStorageConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new DomainError("Private file storage is not configured.", 503);
  }
}

export function sanitizeBlobPathPart(value: string) {
  return (
    value
      .trim()
      .replace(/[/\\?%*:|"<>]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 140) || "file"
  );
}

export function formatAttachmentContentDisposition(filename: string) {
  const fallback = filename.replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function readRequiredPrivateFormFile(
  request: Request,
  options: {
    fieldName?: string;
    maxBytes?: number;
  } = {},
): Promise<PrivateFormFile> {
  const { fieldName = "file", maxBytes = MAX_PRIVATE_FILE_BYTES } = options;
  const formData = await request.formData();
  const value = formData.get(fieldName);

  if (!(value instanceof File)) {
    throw new DomainError("File is required.");
  }

  if (value.size <= 0) {
    throw new DomainError("File is empty.");
  }

  if (value.size > maxBytes) {
    throw new DomainError("File must be 50 MB or smaller.");
  }

  return {
    file: value,
    filename: value.name || "upload",
    contentType: value.type || DEFAULT_PRIVATE_FILE_CONTENT_TYPE,
    sizeBytes: value.size,
  };
}

export async function uploadPrivateFile(
  file: PrivateFormFile,
  keyParts: string[],
): Promise<PrivateFileUpload> {
  const storageKey = [
    ...keyParts,
    `${crypto.randomUUID()}-${sanitizeBlobPathPart(file.filename)}`,
  ].join("/");

  const blob = await put(storageKey, file.file, {
    access: "private",
    contentType: file.contentType,
  });

  return {
    ...file,
    storageKey,
    blobUrl: blob.url,
  };
}

export async function deletePrivateBlobQuietly(urlOrPathname: string) {
  await del(urlOrPathname).catch(() => undefined);
}

export async function deletePrivateBlobIfConfigured(urlOrPathname: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await deletePrivateBlobQuietly(urlOrPathname);
}

export async function deletePrivateBlobsIfConfigured(urlsOrPathnames: string[]) {
  if (!process.env.BLOB_READ_WRITE_TOKEN || urlsOrPathnames.length === 0) return;
  await Promise.all(urlsOrPathnames.map((url) => deletePrivateBlobQuietly(url)));
}

export async function getPrivateBlobForDownload(
  urlOrPathname: string
): Promise<PrivateBlobRead | null> {
  for (let attempt = 1; attempt <= PRIVATE_BLOB_READ_ATTEMPTS; attempt += 1) {
    const blob = await get(urlOrPathname, {
      access: "private",
      useCache: false,
    });

    if (blob?.statusCode === 200 && blob.stream) {
      return blob;
    }

    if (attempt < PRIVATE_BLOB_READ_ATTEMPTS) {
      await wait(PRIVATE_BLOB_READ_RETRY_MS);
    }
  }

  return null;
}
