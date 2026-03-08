import { NextResponse } from "next/server";
import { createUnitDefinition } from "@/app/(dashboard)/inventory/queries";
import { insertUnitDefinitionSchema } from "@/lib/schemas/units";
import { apiHandler } from "@/lib/api/handler";

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = insertUnitDefinitionSchema.parse(body);
  const unit = await createUnitDefinition(data);
  return NextResponse.json(unit, { status: 201 });
});
