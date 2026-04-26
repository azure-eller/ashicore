import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateXeroSettings } from "@/lib/dal/xero";

const updateSchema = z.object({
  defaultAccountCode: z.string().trim().nullable(),
  defaultTaxType: z.string().trim().nullable(),
  invoiceStatusPreference: z.enum(["DRAFT", "AUTHORISED"]),
  autoEmailSalesInvoices: z.boolean(),
});

export const PUT = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = updateSchema.parse(body);

  const connection = await updateXeroSettings({
    defaultAccountCode: data.defaultAccountCode?.length
      ? data.defaultAccountCode
      : null,
    defaultTaxType: data.defaultTaxType?.length ? data.defaultTaxType : null,
    invoiceStatusPreference: data.invoiceStatusPreference,
    autoEmailSalesInvoices: data.autoEmailSalesInvoices,
  });

  if (!connection) {
    return NextResponse.json(
      { error: "Xero is not connected." },
      { status: 409 }
    );
  }

  return NextResponse.json(connection);
});
