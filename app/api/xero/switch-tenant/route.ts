import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { switchActiveXeroTenant } from "@/lib/dal/xero";

const bodySchema = z.object({
  tenantId: z.string().min(1),
});

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = bodySchema.parse(body);

  const result = await switchActiveXeroTenant(data.tenantId);
  if (!result) {
    return NextResponse.json(
      { error: "Xero is not connected." },
      { status: 409 }
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          "That Xero organisation isn't in this connection's authorised list. Reconnect to update access.",
      },
      { status: 400 }
    );
  }

  return NextResponse.json(result.summary);
});
