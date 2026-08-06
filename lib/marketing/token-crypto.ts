import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError } from "@/lib/errors/domain-error";
import { env } from "@/lib/env";

const PREFIX = "enc:v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

type KeyRing = { activeId: string; keys: Map<string, Buffer> };

function readKeyRing(): KeyRing {
  const activeId = env.GOOGLE_TOKEN_ENCRYPTION_KEY_ID?.trim();
  const raw = env.GOOGLE_TOKEN_ENCRYPTION_KEYS?.trim();
  if (!activeId || !raw) {
    throw new DomainError("Google token encryption is not configured.", 503);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainError("GOOGLE_TOKEN_ENCRYPTION_KEYS must be valid JSON.", 500);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DomainError("GOOGLE_TOKEN_ENCRYPTION_KEYS must be a key map.", 500);
  }

  const keys = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_.:-]+$/.test(id) || typeof value !== "string") {
      throw new DomainError("Google token encryption key map is invalid.", 500);
    }
    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES) {
      throw new DomainError(`Google token key '${id}' must decode to 32 bytes.`, 500);
    }
    keys.set(id, key);
  }
  if (!keys.has(activeId)) {
    throw new DomainError(
      "GOOGLE_TOKEN_ENCRYPTION_KEY_ID must name a configured key.",
      500,
    );
  }
  return { activeId, keys };
}

export function encryptGoogleToken(value: string) {
  const ring = readKeyRing();
  const key = ring.keys.get(ring.activeId)!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: [
      PREFIX,
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      encrypted.toString("base64"),
    ].join(":"),
    keyId: ring.activeId,
  };
}

export function decryptGoogleToken(ciphertext: string, keyId: string) {
  const key = readKeyRing().keys.get(keyId);
  if (!key) throw new DomainError(`Google token key '${keyId}' is unavailable.`, 500);
  const parts = ciphertext.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== PREFIX) {
    throw new DomainError("Stored Google token ciphertext is invalid.", 500);
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(parts[2]!, "base64"),
    );
    decipher.setAuthTag(Buffer.from(parts[3]!, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[4]!, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DomainError("Stored Google token could not be decrypted.", 500);
  }
}
