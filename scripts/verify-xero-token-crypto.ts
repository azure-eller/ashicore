import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decryptXeroToken,
  encryptXeroToken,
  isEncryptedXeroToken,
  resetXeroTokenEncryptionKeyForTests,
} from "@/lib/xero/token-crypto";
import {
  createNextKeyConfig,
  parseArgs,
  parseKeyConfig,
  redactDatabaseUrl,
  redactSecret,
} from "./rotate-xero-token-key";

function withEnv(
  values: Partial<Record<
    | "XERO_TOKEN_ENCRYPTION_KEY"
    | "XERO_TOKEN_ENCRYPTION_KEY_ID"
    | "XERO_TOKEN_ENCRYPTION_KEYS",
    string | undefined
  >>,
  fn: () => void
) {
  const previous = process.env.XERO_TOKEN_ENCRYPTION_KEY;
  const previousKeyId = process.env.XERO_TOKEN_ENCRYPTION_KEY_ID;
  const previousKeys = process.env.XERO_TOKEN_ENCRYPTION_KEYS;

  for (const [key, value] of Object.entries(values)) {
    if (value == null) {
      delete process.env[key as keyof typeof values];
    } else {
      process.env[key as keyof typeof values] = value;
    }
  }
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
    if (previousKeys == null) {
      delete process.env.XERO_TOKEN_ENCRYPTION_KEYS;
    } else {
      process.env.XERO_TOKEN_ENCRYPTION_KEYS = previousKeys;
    }
    resetXeroTokenEncryptionKeyForTests();
  }
}

function withKey(value: string | undefined, fn: () => void) {
  withEnv(
    {
      XERO_TOKEN_ENCRYPTION_KEY: value,
      XERO_TOKEN_ENCRYPTION_KEY_ID: "verify",
      XERO_TOKEN_ENCRYPTION_KEYS: undefined,
    },
    fn
  );
}

const validKey = randomBytes(32).toString("base64");
const oldKey = randomBytes(32).toString("base64");
const newKey = randomBytes(32).toString("base64");

withKey(validKey, () => {
  const encrypted = encryptXeroToken("refresh-token-value");
  assert.equal(encrypted.keyId, "verify");
  assert.ok(isEncryptedXeroToken(encrypted.ciphertext));
  assert.equal(
    decryptXeroToken(encrypted.ciphertext, "verify"),
    "refresh-token-value"
  );

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

withEnv(
  {
    XERO_TOKEN_ENCRYPTION_KEY: undefined,
    XERO_TOKEN_ENCRYPTION_KEY_ID: "new",
    XERO_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ old: oldKey, new: newKey }),
  },
  () => {
    const encrypted = encryptXeroToken("new-token-value");
    assert.equal(encrypted.keyId, "new");
    assert.equal(decryptXeroToken(encrypted.ciphertext, "new"), "new-token-value");

    withEnv(
      {
        XERO_TOKEN_ENCRYPTION_KEY: undefined,
        XERO_TOKEN_ENCRYPTION_KEY_ID: "old",
        XERO_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ old: oldKey, new: newKey }),
      },
      () => {
        const oldEncrypted = encryptXeroToken("old-token-value");
        assert.equal(oldEncrypted.keyId, "old");
        withEnv(
          {
            XERO_TOKEN_ENCRYPTION_KEY: undefined,
            XERO_TOKEN_ENCRYPTION_KEY_ID: "new",
            XERO_TOKEN_ENCRYPTION_KEYS: JSON.stringify({
              old: oldKey,
              new: newKey,
            }),
          },
          () => {
            assert.equal(
              decryptXeroToken(oldEncrypted.ciphertext, "old"),
              "old-token-value"
            );
            assert.throws(
              () => decryptXeroToken(oldEncrypted.ciphertext, "missing"),
              /not configured/
            );
            assert.throws(
              () => decryptXeroToken(oldEncrypted.ciphertext, null),
              /no encryption key ID/
            );
          }
        );
      }
    );
  }
);

withEnv(
  {
    XERO_TOKEN_ENCRYPTION_KEY: oldKey,
    XERO_TOKEN_ENCRYPTION_KEY_ID: "old",
    XERO_TOKEN_ENCRYPTION_KEYS: undefined,
  },
  () => {
    const encrypted = encryptXeroToken("legacy-fallback-value");
    assert.equal(encrypted.keyId, "old");
    withEnv(
      {
        XERO_TOKEN_ENCRYPTION_KEY: oldKey,
        XERO_TOKEN_ENCRYPTION_KEY_ID: "new",
        XERO_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ old: oldKey, new: newKey }),
      },
      () => {
        assert.equal(
          decryptXeroToken(encrypted.ciphertext, null),
          "legacy-fallback-value"
        );
      }
    );
  }
);

for (const badEnv of [
  {
    XERO_TOKEN_ENCRYPTION_KEY_ID: "new",
    XERO_TOKEN_ENCRYPTION_KEYS: "{",
  },
  {
    XERO_TOKEN_ENCRYPTION_KEY_ID: "missing",
    XERO_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ new: newKey }),
  },
  {
    XERO_TOKEN_ENCRYPTION_KEY_ID: "new",
    XERO_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ new: randomBytes(31).toString("base64") }),
  },
]) {
  withEnv(
    {
      XERO_TOKEN_ENCRYPTION_KEY: undefined,
      ...badEnv,
    },
    () => {
      assert.throws(() => encryptXeroToken("value"));
    }
  );
}

assert.deepEqual(parseArgs(["--environment", "production", "--apply"]), {
  apply: true,
  environment: "production",
  envFile: null,
  newKeyId: null,
  newKey: null,
});

const parsedConfig = parseKeyConfig({
  XERO_TOKEN_ENCRYPTION_KEY_ID: "old",
  XERO_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ old: oldKey }),
});
const nextConfig = createNextKeyConfig(parsedConfig, "new", newKey);
assert.equal(nextConfig.activeKeyId, "new");
assert.equal(nextConfig.keys.old, oldKey);
assert.equal(nextConfig.keys.new, newKey);
assert.throws(() => createNextKeyConfig(parsedConfig, "old", newKey), /already exists/);
assert.throws(
  () =>
    parseKeyConfig({
      XERO_TOKEN_ENCRYPTION_KEY_ID: "missing",
      XERO_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ old: oldKey }),
    }),
  /must exist/
);
assert.equal(redactSecret("abcdefghijkl"), "abcd...ijkl");
assert.equal(
  redactDatabaseUrl("postgresql://user:password@example.com:5432/erp"),
  "postgresql://[redacted]@example.com:5432/erp"
);

console.log("Xero token crypto verification passed.");
