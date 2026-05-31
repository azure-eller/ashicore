import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { markNotificationReadForRequest } from "@/lib/dal/reports";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const row = await markNotificationReadForRequest(request.headers, id);

  if (!row) {
    return jsonNotFound("Notification not found.");
  }

  return NextResponse.json({ id: row.id });
});
