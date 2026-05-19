import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const value = await withAuthedOrgContext(async (tx) => {
    const result = await tx.execute(
      sql`SELECT nextval('inventory.internal_barcode_seq')::text AS value`,
    );
    return (result.rows[0] as { value: string }).value;
  });
  return NextResponse.json({ value });
});
