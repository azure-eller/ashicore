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

type EncryptionKeyRing = {
  activeKey: EncryptionKey;
  keysById: Map<string, EncryptionKey>;
  legacyFallbackKey: EncryptionKey | null;
};

let cachedKeyRing: EncryptionKeyRing | null = null;

function assertValidKeyId(keyId: string, envName: string) {
  if (!keyId) {
    throw new XeroError(`${envName} is required.`, 500);
  }

  if (!/^[A-Za-z0-9_.:-]+$/.test(keyId)) {
    throw new XeroError(
      `${envName} may contain only letters, numbers, dots, underscores, colons, or dashes.`,
      500
    );
  }
}

function parseEncryptionKey(
  raw: string | undefined,
  keyId: string,
  envName: string
): EncryptionKey {
  assertValidKeyId(keyId, "XERO_TOKEN_ENCRYPTION_KEY_ID");

  if (!raw) {
    throw new XeroError(`${envName} is not configured.`, 500);
  }

  if (raw.trim() !== raw || raw.length === 0) {
    throw new XeroError(
      `${envName} must be base64 without surrounding whitespace.`,
      500
    );
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    throw new XeroError(
      `${envName} must be valid base64.`,
      500
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new XeroError(
      `${envName} must decode to exactly 32 bytes.`,
      500
    );
  }

  return { key, keyId };
}

function readMultiKeyRing(): EncryptionKeyRing | null {
  const rawMap = process.env.XERO_TOKEN_ENCRYPTION_KEYS?.trim();
  if (!rawMap) return null;

  const activeKeyId = process.env.XERO_TOKEN_ENCRYPTION_KEY_ID?.trim();
  assertValidKeyId(activeKeyId ?? "", "XERO_TOKEN_ENCRYPTION_KEY_ID");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMap);
  } catch {
    throw new XeroError("XERO_TOKEN_ENCRYPTION_KEYS must be valid JSON.", 500);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new XeroError(
      "XERO_TOKEN_ENCRYPTION_KEYS must be a JSON object mapping key IDs to base64 keys.",
      500
    );
  }

  const keysById = new Map<string, EncryptionKey>();
  for (const [keyId, rawKey] of Object.entries(parsed)) {
    assertValidKeyId(keyId, "XERO_TOKEN_ENCRYPTION_KEYS key ID");
    if (typeof rawKey !== "string") {
      throw new XeroError(
        `XERO_TOKEN_ENCRYPTION_KEYS.${keyId} must be a base64 string.`,
        500
      );
    }
    keysById.set(
      keyId,
      parseEncryptionKey(rawKey, keyId, `XERO_TOKEN_ENCRYPTION_KEYS.${keyId}`)
    );
  }

  const activeKey = keysById.get(activeKeyId!);
  if (!activeKey) {
    throw new XeroError(
      "XERO_TOKEN_ENCRYPTION_KEY_ID must exist in XERO_TOKEN_ENCRYPTION_KEYS.",
      500
    );
  }

  const legacyRaw = process.env.XERO_TOKEN_ENCRYPTION_KEY;
  const legacyFallbackKey = legacyRaw
    ? parseEncryptionKey(
        legacyRaw,
        process.env.XERO_TOKEN_ENCRYPTION_KEY_ID?.trim() || "default",
        "XERO_TOKEN_ENCRYPTION_KEY"
      )
    : null;

  return { activeKey, keysById, legacyFallbackKey };
}

function readSingleKeyRing(): EncryptionKeyRing {
  const keyId = process.env.XERO_TOKEN_ENCRYPTION_KEY_ID?.trim() || "default";
  const activeKey = parseEncryptionKey(
    process.env.XERO_TOKEN_ENCRYPTION_KEY,
    keyId,
    "XERO_TOKEN_ENCRYPTION_KEY"
  );
  return {
    activeKey,
    keysById: new Map([[activeKey.keyId, activeKey]]),
    legacyFallbackKey: activeKey,
  };
}

function readEncryptionKeyRing(): EncryptionKeyRing {
  return readMultiKeyRing() ?? readSingleKeyRing();
}

export function resetXeroTokenEncryptionKeyForTests() {
  cachedKeyRing = null;
}

function getEncryptionKeyRing(): EncryptionKeyRing {
  cachedKeyRing ??= readEncryptionKeyRing();
  return cachedKeyRing;
}

function getActiveEncryptionKey(): EncryptionKey {
  return getEncryptionKeyRing().activeKey;
}

function getDecryptionKey(keyId: string | null | undefined): EncryptionKey {
  const keyRing = getEncryptionKeyRing();
  const normalizedKeyId = keyId?.trim();

  if (normalizedKeyId) {
    const key = keyRing.keysById.get(normalizedKeyId);
    if (!key) {
      throw new XeroError(
        `Xero token encryption key '${normalizedKeyId}' is not configured.`,
        500
      );
    }
    return key;
  }

  if (keyRing.legacyFallbackKey) {
    return keyRing.legacyFallbackKey;
  }

  throw new XeroError(
    "Stored Xero token has no encryption key ID and no legacy fallback key is configured.",
    500
  );
}

export function isEncryptedXeroToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${ENCRYPTED_PREFIX}:`);
}

export function encryptXeroToken(value: string): {
  ciphertext: string;
  keyId: string;
} {
  const { key, keyId } = getActiveEncryptionKey();
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

export function decryptXeroToken(
  value: string,
  keyId?: string | null
): string {
  const { key } = getDecryptionKey(keyId);
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
  return getActiveEncryptionKey().keyId;
}
