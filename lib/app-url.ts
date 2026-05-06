import "server-only";

import { APP_URL } from "@/lib/app-brand";

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
    normalizeUrl(process.env.BETTER_AUTH_URL) ??
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL);

  if (explicitUrl) {
    return explicitUrl;
  }

  if (process.env.VERCEL_ENV === "preview") {
    const vercelPreviewUrl =
      normalizeUrl(process.env.VERCEL_BRANCH_URL) ??
      normalizeUrl(process.env.VERCEL_URL);

    if (vercelPreviewUrl) {
      return vercelPreviewUrl;
    }
  }

  if (process.env.NODE_ENV === "production") {
    return APP_URL;
  }

  if (process.env.PORT) {
    return `http://localhost:${process.env.PORT}`;
  }

  return "http://localhost:3000";
}
