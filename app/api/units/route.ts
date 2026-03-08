import { NextRequest, NextResponse } from "next/server";
import { createUnitDefinition } from "@/app/(dashboard)/inventory/queries";
import { insertUnitDefinitionSchema } from "@/lib/schemas/units";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const result = insertUnitDefinitionSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json(
      { errors: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const unit = await createUnitDefinition(result.data);
  return NextResponse.json(unit, { status: 201 });
}
