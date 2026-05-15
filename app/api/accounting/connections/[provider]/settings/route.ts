import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { isAccountingProvider } from "@/lib/accounting/providers";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateAccountingConnectionSettings } from "@/lib/dal/accounting";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

const updateSchema = z.object({
  autoSyncPurchaseOrdersFromAccounting: z.boolean(),
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { provider } = await (ctx as RouteContext).params;
  if (!isAccountingProvider(provider)) {
    return NextResponse.json(
      { error: "Unsupported accounting provider." },
      { status: 400 }
    );
  }

  const body = await request.json();
  const data = updateSchema.parse(body);
  const summary = await updateAccountingConnectionSettings({
    provider,
    autoSyncPurchaseOrdersFromAccounting:
      data.autoSyncPurchaseOrdersFromAccounting,
  });

  if (!summary) {
    return NextResponse.json(
      { error: "Accounting provider is not connected." },
      { status: 409 }
    );
  }

  return NextResponse.json(summary);
});
