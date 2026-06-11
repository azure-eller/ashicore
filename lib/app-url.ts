import "server-only";

import { APP_URL } from "@/lib/app-brand";
import { env } from "@/lib/env";

function normalizeUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function getCanonicalAppUrl() {
  const explicitUrl =
    normalizeUrl(env.BETTER_AUTH_URL) ??
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL);

  if (explicitUrl) {
    return explicitUrl;
  }

  if (env.VERCEL_ENV === "preview") {
    const vercelPreviewUrl =
      normalizeUrl(env.VERCEL_BRANCH_URL) ??
      normalizeUrl(env.VERCEL_URL);

    if (vercelPreviewUrl) {
      return vercelPreviewUrl;
    }
  }

  if (process.env.NODE_ENV === "production") {
    return APP_URL;
  }

  if (env.PORT) {
    return `http://localhost:${env.PORT}`;
  }

  return "http://localhost:3000";
}
