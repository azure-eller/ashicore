import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getItemUsageHistory } from "@/app/(dashboard)/inventory/queries";

const usageHistorySearchSchema = z.object({
  days: z.coerce.number().int().min(30).max(365).optional(),
  bucket: z.enum(["week"]).optional(),
  mode: z.enum(["usage", "production"]).optional(),
});

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const { searchParams } = new URL(request.url);
  const filters = usageHistorySearchSchema.parse(
    Object.fromEntries(searchParams.entries())
  );
  const usage = await getItemUsageHistory(id, {
    days: filters.days,
    bucket: filters.bucket,
    mode: filters.mode,
  });

  if (!usage) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json(usage);
});
