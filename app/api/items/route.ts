// app/api/items/route.ts
import { NextResponse } from "next/server";
import { getItems } from "@/app/(dashboard)/inventory/queries";

export async function GET() {
  const data = await getItems();
  return NextResponse.json(data);
}
