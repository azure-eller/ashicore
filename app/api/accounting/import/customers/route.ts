import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { importCustomersFromXero } from "@/lib/xero/import-contacts";
import { XeroError } from "@/lib/xero/errors";

const bodySchema = z
  .object({
    allowDemoCompany: z.boolean().optional(),
  })
  .optional();

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const context = await getAuthedMemberContext();
  const body = bodySchema.parse(await request.json().catch(() => undefined));

  try {
    const result = await importCustomersFromXero(context.orgId, {
      allowDemoCompany: body?.allowDemoCompany ?? false,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof XeroError) return error.toResponse();
    throw error;
  }
});
