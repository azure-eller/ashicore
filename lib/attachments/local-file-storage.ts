import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const LOCAL_ATTACHMENT_SCHEME = "local://";

function localAttachmentRoot() {
  return process.env.LOCAL_ATTACHMENT_DIR
    ? path.resolve(process.env.LOCAL_ATTACHMENT_DIR)
    : path.join(process.cwd(), ".local-attachments");
}

function localAttachmentPath(storageKey: string) {
  const root = localAttachmentRoot();
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid local attachment path.");
  }
  return resolved;
}

export function canUseLocalAttachmentStorage() {
  return process.env.NODE_ENV !== "production" || process.env.CI === "true";
}

export function isLocalAttachmentUrl(value: string) {
  return value.startsWith(LOCAL_ATTACHMENT_SCHEME);
}

export async function writeLocalAttachment(storageKey: string, file: File) {
  const target = localAttachmentPath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await file.arrayBuffer()));
  return `${LOCAL_ATTACHMENT_SCHEME}${storageKey}`;
}

export async function readLocalAttachment(url: string) {
  if (!isLocalAttachmentUrl(url)) return null;
  return readFile(localAttachmentPath(url.slice(LOCAL_ATTACHMENT_SCHEME.length)));
}

export async function deleteLocalAttachment(url: string) {
  if (!isLocalAttachmentUrl(url)) return;
  await rm(localAttachmentPath(url.slice(LOCAL_ATTACHMENT_SCHEME.length)), {
    force: true,
  });
}
