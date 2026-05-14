import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decryptXeroToken,
  encryptXeroToken,
  isEncryptedXeroToken,
  resetXeroTokenEncryptionKeyForTests,
} from "@/lib/xero/token-crypto";

function withKey(value: string | undefined, fn: () => void) {
  const previous = process.env.XERO_TOKEN_ENCRYPTION_KEY;
  const previousKeyId = process.env.XERO_TOKEN_ENCRYPTION_KEY_ID;
  if (value == null) {
    delete process.env.XERO_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.XERO_TOKEN_ENCRYPTION_KEY = value;
  }
  process.env.XERO_TOKEN_ENCRYPTION_KEY_ID = "verify";
  resetXeroTokenEncryptionKeyForTests();

  try {
    fn();
  } finally {
    if (previous == null) {
      delete process.env.XERO_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.XERO_TOKEN_ENCRYPTION_KEY = previous;
    }
    if (previousKeyId == null) {
      delete process.env.XERO_TOKEN_ENCRYPTION_KEY_ID;
    } else {
      process.env.XERO_TOKEN_ENCRYPTION_KEY_ID = previousKeyId;
    }
    resetXeroTokenEncryptionKeyForTests();
  }
}

const validKey = randomBytes(32).toString("base64");

withKey(validKey, () => {
  const encrypted = encryptXeroToken("refresh-token-value");
  assert.equal(encrypted.keyId, "verify");
  assert.ok(isEncryptedXeroToken(encrypted.ciphertext));
  assert.equal(decryptXeroToken(encrypted.ciphertext), "refresh-token-value");

  const parts = encrypted.ciphertext.split(":");
  parts[4] = `${parts[4][0] === "A" ? "B" : "A"}${parts[4].slice(1)}`;
  const tampered = parts.join(":");
  assert.throws(() => decryptXeroToken(tampered), /could not be decrypted|invalid/);
});

for (const badKey of [
  undefined,
  "",
  ` ${validKey}`,
  "not-base64",
  randomBytes(31).toString("base64"),
]) {
  withKey(badKey, () => {
    assert.throws(() => encryptXeroToken("value"));
  });
}

console.log("Xero token crypto verification passed.");
