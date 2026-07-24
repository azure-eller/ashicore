import { DomainError } from "@/lib/errors/domain-error";

export type XeroErrorExtra = {
  validationErrors?: Array<{ property: string; message: string }>;
  /** Set when a 403 means the connection lacks a required scope (e.g. reports). */
  reason?: "missing_scope";
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
  "cookie",
  "set-cookie",
  "client_secret",
  "clientsecret",
  "code",
]);

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getErrorObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") return parseJsonObject(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Recursively redact secrets before the value is thrown, logged, or sent
 * to Sentry. Mutates copies — never the original — to stay safe for any caller.
 */
export function redactXeroError(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    const parsed = parseJsonObject(value);
    return parsed ? redactXeroError(parsed) : value;
  }
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

export function extractXeroStatusCode(error: unknown): number | null {
  const object = getErrorObject(error);
  if (!object) return null;

  const response = object.response;
  const responseStatus =
    response && typeof response === "object"
      ? (response as { statusCode?: unknown; status?: unknown })
      : null;
  const status =
    responseStatus?.statusCode ??
    responseStatus?.status ??
    object.statusCode ??
    object.status;

  return typeof status === "number" ? status : null;
}

export function extractXeroMessage(error: unknown): string {
  const object = getErrorObject(error);
  if (object) {
    const response = object.response;
    const body =
      response && typeof response === "object"
        ? (response as { body?: unknown }).body
        : object.body;
    const bodyMessage = extractXeroBodyMessage(body);
    if (bodyMessage) return bodyMessage;
    if (typeof body === "string" && body.trim() !== "") return body;
    if (typeof object.message === "string" && object.message.trim() !== "") {
      return object.message;
    }
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") {
    if (/authorization|access_token|refresh_token|bearer\s+/i.test(error)) {
      return "Xero request failed.";
    }
    return error;
  }
  return "Xero request failed.";
}

function extractXeroBodyMessage(body: unknown): string | null {
  if (body == null) return null;

  if (typeof body === "string") {
    const parsed = parseJsonObject(body);
    return parsed ? extractXeroBodyMessage(parsed) : body.trim() || null;
  }

  if (Array.isArray(body)) {
    const messages = body
      .map((item) => extractXeroBodyMessage(item))
      .filter((message): message is string => Boolean(message));
    return messages.length > 0 ? messages.join("; ") : null;
  }

  if (typeof body !== "object") return null;

  const object = body as Record<string, unknown>;
  const directMessage = object.Message ?? object.message ?? object.Detail ?? object.detail;
  const nestedMessages = [
    object.Elements,
    object.ValidationErrors,
    object.validationErrors,
    object.Errors,
    object.errors,
  ]
    .map((value) => extractXeroBodyMessage(value))
    .filter((message): message is string => Boolean(message));

  const messages = [
    typeof directMessage === "string" ? directMessage.trim() : null,
    ...nestedMessages,
  ].filter((message): message is string => Boolean(message));

  return messages.length > 0 ? [...new Set(messages)].join("; ") : null;
}
