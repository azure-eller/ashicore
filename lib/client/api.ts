import {
  formatFieldErrorMessage,
  isFieldErrorRecord,
  type FieldErrorRecord,
} from "@/lib/api/field-errors";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiJsonOptions = {
  method?: HttpMethod;
  body?: unknown;
  fallbackError?: string;
  idempotencyKey?: string;
  headers?: HeadersInit;
  mapError?: (status: number, body: unknown) => Error | undefined;
};

export type ApiJsonRequestInit = Pick<
  ApiJsonOptions,
  "method" | "body" | "headers" | "idempotencyKey"
>;

export class ApiJsonError extends Error {
  status: number;
  body: unknown;
  errors?: FieldErrorRecord;

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

export class ApiClientError extends Error {
  constructor(
    name: string,
    message: string,
    public status: number,
    public fieldErrors?: FieldErrorRecord,
  ) {
    super(message);
    this.name = name;
  }
}

type ApiClientErrorMapperFactory<TError extends Error> = (args: {
  message: string;
  status: number;
  fieldErrors?: FieldErrorRecord;
  body: unknown;
  path: string;
}) => TError;

type ApiJsonFallback = string | ((path: string) => string);
type ApiJsonMapErrorFallback = string | ((status: number, path: string) => string);

type ApiErrorBody = {
  error?: unknown;
  errors?: unknown;
};

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return typeof body === "object" && body != null;
}

export function getApiErrorMessage(body: unknown, fallback: string) {
  if (isApiErrorBody(body)) {
    if (typeof body.error === "string" && body.error.trim() !== "") {
      return body.error;
    }

    if (isFieldErrorRecord(body.errors)) {
      return formatFieldErrorMessage(body.errors);
    }
  }

  return fallback;
}

export function getApiFieldErrors(body: unknown): FieldErrorRecord | undefined {
  return isApiErrorBody(body) && isFieldErrorRecord(body.errors)
    ? body.errors
    : undefined;
}

export function requireApiProperty<
  TBody extends Record<string, unknown>,
  TKey extends keyof TBody,
>(
  body: TBody,
  key: TKey,
  fallbackError: string,
): Exclude<TBody[TKey], null | undefined> {
  const value = body[key];
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    throw new Error(fallbackError);
  }
  return value as Exclude<TBody[TKey], null | undefined>;
}

export function createApiClientErrorMapper<TError extends Error>(
  path: string,
  createError: ApiClientErrorMapperFactory<TError>,
  fallback?: string | ((status: number, path: string) => string),
) {
  return (status: number, body: unknown) =>
    createError({
      message: getApiErrorMessage(
        body,
        typeof fallback === "function"
          ? fallback(status, path)
          : fallback ?? `Request failed (${status} ${path})`,
      ),
      status,
      fieldErrors: getApiFieldErrors(body),
      body,
      path,
    });
}

function resolveApiJsonFallback(fallback: ApiJsonFallback, path: string) {
  return typeof fallback === "function" ? fallback(path) : fallback;
}

export function createApiJsonRequester<TError extends Error>(
  createError: ApiClientErrorMapperFactory<TError>,
  defaultFallback: ApiJsonFallback = "Request failed",
  defaultMapErrorFallback?: ApiJsonMapErrorFallback,
) {
  return <T>(
    path: string,
    init?: ApiJsonRequestInit,
    fallback?: ApiJsonFallback,
    mapErrorFallback = defaultMapErrorFallback,
  ) => {
    const fallbackError = resolveApiJsonFallback(fallback ?? defaultFallback, path);
    return apiJson<T>(path, {
      method: init?.method ?? "GET",
      body: init && "body" in init ? init.body : undefined,
      headers: init?.headers,
      idempotencyKey: init?.idempotencyKey,
      fallbackError,
      mapError: createApiClientErrorMapper(
        path,
        createError,
        mapErrorFallback ?? fallbackError,
      ),
    });
  };
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

async function parseJsonResponse(response: Response) {
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
    if (!response.ok) return undefined;
    throw new ApiJsonError("Invalid JSON response.", response.status, undefined);
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

  const responseBody = await parseJsonResponse(response);

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
