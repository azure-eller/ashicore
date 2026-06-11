import { sql } from "drizzle-orm";
import { db } from "./index";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { Tx };

type WithOrgContextOptions = {
  userId?: string;
  setOrgContext?: (setOrgContext: () => Promise<unknown>) => Promise<unknown>;
};

async function setUserContext(tx: Tx, userId: string) {
  await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
}

/**
 * Low-level helper: sets org context for RLS but does NOT check auth.
 * Prefer `withAuthedOrgContext` from lib/dal/auth.ts in request handlers.
 */
export async function withOrgContext<T>(
  orgId: string,
  callback: (tx: Tx) => Promise<T>,
  options?: WithOrgContextOptions
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config with is_local=true is equivalent to SET LOCAL — parameterized, no raw SQL
    const setOrgContext = async () => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
      if (options?.userId) {
        await setUserContext(tx, options.userId);
      }
    };

    if (options?.setOrgContext) {
      await options.setOrgContext(setOrgContext);
    } else {
      await setOrgContext();
    }

    return callback(tx);
  });
}

export async function withUserContext<T>(
  userId: string,
  callback: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await setUserContext(tx, userId);
    return callback(tx);
  });
}
