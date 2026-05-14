type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiJsonOptions = {
  method?: HttpMethod;
  body?: unknown;
  fallbackError?: string;
  idempotencyKey?: string;
  headers?: HeadersInit;
  mapError?: (status: number, body: unknown) => Error | undefined;
};

export class ApiJsonError extends Error {
  status: number;
  body: unknown;
  errors?: Record<string, string[]>;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiJsonError";
    this.status = status;
    this.body = body;

    if (isApiErrorBody(body) && isFieldErrorRecord(body.errors)) {
      this.errors = body.errors;
    }
  }
}

type ApiErrorBody = {
  error?: unknown;
  errors?: unknown;
};

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return typeof body === "object" && body != null;
}

function isFieldErrorRecord(value: unknown): value is Record<string, string[]> {
  if (typeof value !== "object" || value == null) {
    return false;
  }

  return Object.values(value).every(
    (messages) =>
      Array.isArray(messages) &&
      messages.every((message) => typeof message === "string")
  );
}

function formatFieldErrors(errors: Record<string, string[]>) {
  return Object.entries(errors)
    .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
    .join("; ");
}

export function getApiErrorMessage(body: unknown, fallback: string) {
  if (isApiErrorBody(body)) {
    if (typeof body.error === "string" && body.error.trim() !== "") {
      return body.error;
    }

    if (isFieldErrorRecord(body.errors)) {
      return formatFieldErrors(body.errors);
    }
  }

  return fallback;
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof Blob ||
    value instanceof ArrayBuffer
  );
}

function applyIdempotencyHeader(headers: Headers, idempotencyKey: string) {
  if (headers.has("Idempotency-Key")) {
    return;
  }

  headers.set(
    "Idempotency-Key",
    idempotencyKey.includes(":")
      ? idempotencyKey
      : `${idempotencyKey}:${crypto.randomUUID()}`
  );
}

async function parseJsonResponse(response: Response, fallbackError: string) {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (text.trim() === "") {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiJsonError(
      response.ok ? "Invalid JSON response." : fallbackError,
      response.status,
      undefined
    );
  }
}

export async function apiJson<T>(
  url: string,
  {
    method = "GET",
    body,
    fallbackError = "Request failed.",
    idempotencyKey,
    headers,
    mapError,
  }: ApiJsonOptions = {}
): Promise<T> {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Accept")) {
    requestHeaders.set("Accept", "application/json");
  }

  const init: RequestInit = {
    method,
    headers: requestHeaders,
    credentials: "same-origin",
  };

  if (idempotencyKey) {
    applyIdempotencyHeader(requestHeaders, idempotencyKey);
  }

  if (body !== undefined) {
    if (isBodyInit(body)) {
      init.body = body;
    } else {
      if (!requestHeaders.has("Content-Type")) {
        requestHeaders.set("Content-Type", "application/json");
      }
      init.body = JSON.stringify(body);
    }
  }

  const response = await fetch(url, init);
  if (response.redirected) {
    const redirectPath = new URL(response.url).pathname;
    if (redirectPath === "/sign-in") {
      throw new ApiJsonError("Authentication required.", 401, {
        error: "Authentication required.",
      });
    }
  }

  const responseBody = await parseJsonResponse(response, fallbackError);

  if (!response.ok) {
    const mapped = mapError?.(response.status, responseBody);
    if (mapped) {
      throw mapped;
    }

    throw new ApiJsonError(
      getApiErrorMessage(responseBody, fallbackError),
      response.status,
      responseBody
    );
  }

  return responseBody as T;
}
