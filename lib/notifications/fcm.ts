import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { captureAppError } from "@/lib/observability/sentry";

export const FCM_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "fcm-outbox");

export type PushMessage = {
  token: string;
  data: Record<string, string>;
};

export type PushSendResult =
  | { delivery: "sent" }
  | { delivery: "outbox"; filePath: string }
  | { delivery: "failed"; deadToken: boolean; error: string };

let cachedApp: App | null = null;
let configError: string | null = null;

function getFirebaseApp(): App | null {
  if (cachedApp || configError) return cachedApp;
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!encoded) return null;
  try {
    const serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    cachedApp = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
  } catch (error) {
    configError = `FIREBASE_SERVICE_ACCOUNT_KEY is set but invalid: ${
      error instanceof Error ? error.message : String(error)
    }`;
    console.error(`[notifications] ${configError}`);
    captureAppError(error, { module: "notifications", operation: "fcm:init" });
  }
  return cachedApp;
}

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

async function writePushOutbox(message: PushMessage) {
  await fs.mkdir(FCM_OUTBOX_DIR, { recursive: true });
  const tokenHash = createHash("sha256").update(message.token).digest("hex").slice(0, 12);
  const filePath = path.join(FCM_OUTBOX_DIR, `${Date.now()}-${tokenHash}.json`);
  await fs.writeFile(
    filePath,
    JSON.stringify({ ...message, createdAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return filePath;
}

/**
 * Send one data-only push. Without FIREBASE_SERVICE_ACCOUNT_KEY the message is
 * written to a local outbox instead (mirrors lib/email/send.ts), which is also
 * the Playwright test seam. Never throws.
 */
export async function sendPush(message: PushMessage): Promise<PushSendResult> {
  const app = getFirebaseApp();
  if (configError) {
    return { delivery: "failed", deadToken: false, error: configError };
  }
  if (!app) {
    try {
      const filePath = await writePushOutbox(message);
      console.info(`[notifications] wrote push outbox ${filePath}`);
      return { delivery: "outbox", filePath };
    } catch (error) {
      return {
        delivery: "failed",
        deadToken: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    await getMessaging(app).send({
      token: message.token,
      data: message.data,
      android: { priority: "high" },
    });
    return { delivery: "sent" };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return {
      delivery: "failed",
      deadToken: DEAD_TOKEN_CODES.has(code),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
