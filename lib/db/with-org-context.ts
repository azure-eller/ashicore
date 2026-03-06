import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { Tx };

/**
 * Low-level helper: sets org context for RLS but does NOT check auth.
 * Prefer `withAuthedOrgContext` from lib/dal/auth.ts in request handlers.
 */
export async function withOrgContext<T>(
  orgId: string,
  callback: (tx: Tx) => Promise<T>
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]+$/.test(orgId)) {
    throw new Error("Invalid orgId format");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.current_org_id = '${orgId}'`));
    return callback(tx);
  });
}
