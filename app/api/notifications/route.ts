import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getNotificationsForRequest } from "@/lib/dal/reports";

export const GET = apiHandler(async (request: Request) => {
  const data = await getNotificationsForRequest(request.headers);
  return NextResponse.json(data);
});
