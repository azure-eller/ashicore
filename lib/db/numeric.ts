import { sql, type SQLWrapper } from "drizzle-orm";

export function trimScale(expression: SQLWrapper) {
  return sql<string>`trim_scale(${expression})`;
}

export function trimScaleNullable(expression: SQLWrapper) {
  return sql<string | null>`trim_scale(${expression})`;
}
