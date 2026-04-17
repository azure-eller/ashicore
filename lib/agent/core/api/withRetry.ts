function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("429") ||
    error.message.includes("529") ||
    error.message.includes("connection") ||
    error.message.includes("timeout")
  );
}

export async function withRetry<T>(args: {
  signal?: AbortSignal;
  maxRetries?: number;
  operation: (attempt: number) => Promise<T>;
}) {
  const maxRetries = args.maxRetries ?? 3;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    if (args.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      return await args.operation(attempt);
    } catch (error) {
      if (attempt > maxRetries || !isRetryableError(error)) {
        throw error;
      }

      await sleep(250 * attempt);
    }
  }

  throw new Error("Retry loop exhausted");
}
