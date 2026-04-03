import "server-only";

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

  const vercelPreviewUrl =
    normalizeUrl(process.env.VERCEL_BRANCH_URL) ??
    normalizeUrl(process.env.VERCEL_URL);

  if (vercelPreviewUrl) {
    return vercelPreviewUrl;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing BETTER_AUTH_URL or NEXT_PUBLIC_APP_URL — cannot resolve canonical app URL in production."
    );
  }

  if (process.env.PORT) {
    return `http://localhost:${process.env.PORT}`;
  }

  return "http://localhost:3000";
}
