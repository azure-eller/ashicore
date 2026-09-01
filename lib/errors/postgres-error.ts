/**
 * Postgres driver errors do not arrive at a `catch` block as themselves.
 *
 * `drizzle-orm` wraps every driver failure in a `DrizzleQueryError` and hangs
 * the original off `cause`, so the `code` a caller wants (`23505` and friends)
 * is not on the value it caught — it is one or more links down the chain. Code
 * that reads `error.code` directly kept compiling and silently stopped matching
 * when that wrapper landed, which turns a constraint violation the app knows how
 * to explain into a bare "Internal server error".
 *
 * Walk the chain instead of trusting the top of it.
 */

/** Depth cap: chains are two or three links in practice, and `cause` can cycle. */
const MAX_CAUSE_DEPTH = 8;

function isErrorLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The first value in `error`'s cause chain carrying a Postgres `code`, or null.
 *
 * Returns the whole record rather than just the code so callers can also read
 * `constraint`, `table`, `column`, and `schema` off the same object.
 */
export function findPostgresError(
  error: unknown
): Record<string, unknown> | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!isErrorLike(current) || seen.has(current)) return null;
    seen.add(current);

    const code = current.code;
    // Postgres SQLSTATEs are five characters; pg also surfaces libpq codes such
    // as ECONNREFUSED on the same field, and those are not what callers mean.
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return current;
    }

    current = current.cause;
  }

  return null;
}

/** Convenience for the common case: the SQLSTATE, or null. */
export function findPostgresErrorCode(error: unknown): string | null {
  const record = findPostgresError(error);
  return typeof record?.code === "string" ? record.code : null;
}

/** Unique constraint violation — the one the API turns into a 409. */
export const PG_UNIQUE_VIOLATION = "23505";
