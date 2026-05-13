import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { applyXeroPurchasingSync } from "@/lib/xero/import-purchasing";
import { XeroError } from "@/lib/xero/errors";

const bodySchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1),
  allowDemoCompany: z.boolean().optional(),
});

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();
  const body = bodySchema.parse(await request.json());

  try {
    const result = await applyXeroPurchasingSync(context.orgId, body.candidateIds, {
      allowDemoCompany: body.allowDemoCompany ?? false,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof XeroError) return error.toResponse();
    throw error;
  }
});
