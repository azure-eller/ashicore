const MAX_DEPTH = 4;
const MAX_ARRAY_LENGTH = 20;
const MAX_STRING_LENGTH = 500;

function isSensitiveMetadataKey(key: string) {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    compact.includes("authorization") ||
    compact.includes("cookie") ||
    compact.includes("csrf") ||
    compact.includes("password") ||
    compact.includes("refresh") ||
    compact.includes("secret") ||
    compact.includes("token")
  ) {
    return true;
  }

  if (["body", "code", "comment", "note", "raw", "request", "state"].includes(compact)) {
    return true;
  }

  return compact.endsWith("code") && compact !== "statuscode";
}

function sanitizeString(value: string) {
  const scrubbed = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [Filtered]")
    .replace(
      /\b(access|refresh|id)[_-]?token=([^&\s]+)/gi,
      "$1_token=[Filtered]"
    )
    .replace(/\b(password|secret)=([^&\s]+)/gi, "$1=[Filtered]");

  return scrubbed.length > MAX_STRING_LENGTH
    ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}...`
    : scrubbed;
}

export function redactAccountingAuditMetadata(
  value: unknown,
  depth = 0
): unknown {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[Filtered]";

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => redactAccountingAuditMetadata(entry, depth + 1));
  }

  if (typeof value !== "object") return "[Filtered]";

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveMetadataKey(key)) {
      out[key] = "[Filtered]";
      continue;
    }

    out[key] = redactAccountingAuditMetadata(entry, depth + 1);
  }
  return out;
}

export function accountingAuditErrorMetadata(error: unknown) {
  const response = (error as { response?: { statusCode?: number } })?.response;
  return redactAccountingAuditMetadata({
    errorName: (error as Error)?.name ?? "Error",
    message: (error as Error)?.message ?? "unknown",
    oauthError: (error as { error?: string })?.error,
    statusCode:
      response?.statusCode ??
      (error as { statusCode?: number; status?: number })?.statusCode ??
      (error as { status?: number })?.status,
  }) as Record<string, unknown>;
}
