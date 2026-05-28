export type DbTimestamp = Date | string | null | undefined;

export function serializeDbTimestamp(value: DbTimestamp) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
