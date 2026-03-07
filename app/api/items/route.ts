// app/api/items/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getItems } from "@/app/(dashboard)/inventory/queries";

export async function GET(request: NextRequest) {
  const itemType = request.nextUrl.searchParams.get("itemType") ?? undefined;
  const data = await getItems(itemType ? { itemType } : undefined);
  return NextResponse.json(data);
}
