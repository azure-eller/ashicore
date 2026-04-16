import { DomainError } from "@/lib/errors/domain-error";

export type XeroErrorExtra = {
  validationErrors?: Array<{ property: string; message: string }>;
};

export class XeroError extends DomainError<XeroErrorExtra> {
  constructor(
    message: string,
    status: number = 502,
    extra?: XeroErrorExtra
  ) {
    super(message, status, { name: "XeroError", extra });
  }
}

const REDACTED_KEYS = new Set([
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "id_token",
  "idtoken",
  "authorization",
  "client_secret",
  "clientsecret",
  "code",
]);

/**
 * Recursively redact secrets before the value is thrown, logged, or sent
 * to Sentry. Mutates copies — never the original — to stay safe for any caller.
 */
export function redactXeroError(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map(redactXeroError);
  }

  const copy: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      copy[key] = "[REDACTED]";
      continue;
    }
    copy[key] = redactXeroError(inner);
  }
  return copy;
}

export function extractXeroMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Xero request failed.";
}
