import { sql } from "drizzle-orm";
import { db } from "./index";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { Tx };

type WithOrgContextOptions = {
  setOrgContext?: (setOrgContext: () => Promise<unknown>) => Promise<unknown>;
};

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
    const setOrgContext = () =>
      tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);

    if (options?.setOrgContext) {
      await options.setOrgContext(setOrgContext);
    } else {
      await setOrgContext();
    }

    return callback(tx);
  });
}
