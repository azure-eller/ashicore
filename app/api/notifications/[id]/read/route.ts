import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { markNotificationReadForRequest } from "@/lib/dal/reports";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const row = await markNotificationReadForRequest(request.headers, id);

  if (!row) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  return NextResponse.json({ id: row.id });
});
