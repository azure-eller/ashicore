// app/api/items/[id]/route.ts
import { NextResponse } from "next/server";
import { deleteItem } from "@/app/(dashboard)/inventory/queries";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteItem(id);
  return NextResponse.json({ success: true });
}
