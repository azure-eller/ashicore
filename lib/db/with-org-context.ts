import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { Tx };

export async function withOrgContext<T>(
  orgId: string,
  callback: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_org_id = ${orgId}`);
    return callback(tx);
  });
}
