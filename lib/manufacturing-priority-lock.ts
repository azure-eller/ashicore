import { sql } from "drizzle-orm";

import type { Tx } from "@/lib/db/with-org-context";

export async function lockManufacturingPriorityQueueInTx(tx: Tx, orgId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`manufacturing-priority:${orgId}`}))`
  );
}

export async function lockSalesPriorityQueueInTx(tx: Tx, orgId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`sales-priority:${orgId}`}))`
  );
}
