import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { XeroError } from "./errors";

const CIPHER = "aes-256-gcm";
const ENCRYPTED_PREFIX = "enc:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

type EncryptionKey = {
  key: Buffer;
  keyId: string;
};

let cachedKey: EncryptionKey | null = null;

function readEncryptionKey(): EncryptionKey {
  const raw = process.env.XERO_TOKEN_ENCRYPTION_KEY;
  const keyId = process.env.XERO_TOKEN_ENCRYPTION_KEY_ID?.trim() || "default";

  if (!raw) {
    throw new XeroError("XERO_TOKEN_ENCRYPTION_KEY is not configured.", 500);
  }

  if (raw.trim() !== raw || raw.length === 0) {
    throw new XeroError(
      "XERO_TOKEN_ENCRYPTION_KEY must be base64 without surrounding whitespace.",
      500
    );
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    throw new XeroError(
      "XERO_TOKEN_ENCRYPTION_KEY must be valid base64.",
      500
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new XeroError(
      "XERO_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.",
      500
    );
  }

  return { key, keyId };
}

export function resetXeroTokenEncryptionKeyForTests() {
  cachedKey = null;
}

function getEncryptionKey(): EncryptionKey {
  cachedKey ??= readEncryptionKey();
  return cachedKey;
}

export function isEncryptedXeroToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${ENCRYPTED_PREFIX}:`);
}

export function encryptXeroToken(value: string): {
  ciphertext: string;
  keyId: string;
} {
  const { key, keyId } = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: [
      ENCRYPTED_PREFIX,
      iv.toString("base64"),
      tag.toString("base64"),
      encrypted.toString("base64"),
    ].join(":"),
    keyId,
  };
}

export function decryptXeroToken(value: string): string {
  const { key } = getEncryptionKey();
  const parts = value.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== ENCRYPTED_PREFIX) {
    throw new XeroError("Stored Xero token is not encrypted with enc:v1.", 500);
  }

  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const encrypted = Buffer.from(parts[4], "base64");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new XeroError("Stored Xero token ciphertext is invalid.", 500);
  }

  try {
    const decipher = createDecipheriv(CIPHER, key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new XeroError("Stored Xero token could not be decrypted.", 500);
  }
}

export function getXeroTokenEncryptionKeyId(): string {
  return getEncryptionKey().keyId;
}
