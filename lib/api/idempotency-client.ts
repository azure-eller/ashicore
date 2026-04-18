export function createIdempotencyHeaders(
  operationName: string,
  headers?: HeadersInit
) {
  const nextHeaders = new Headers(headers);

  if (!nextHeaders.has("Idempotency-Key")) {
    nextHeaders.set("Idempotency-Key", `${operationName}:${crypto.randomUUID()}`);
  }

  return nextHeaders;
}
