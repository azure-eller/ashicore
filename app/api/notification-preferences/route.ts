import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import {
  getNotificationPreferencesForRequest,
  upsertNotificationPreferenceForRequest,
} from "@/lib/dal/notifications";
import { upsertNotificationPreferenceSchema } from "@/lib/schemas/notifications";

export const GET = apiHandler(async (request) => {
  const data = await getNotificationPreferencesForRequest(request.headers);
  return NextResponse.json(data);
});

export const PUT = apiHandler(async (request) => {
  const data = await parseJsonBody(request, upsertNotificationPreferenceSchema);
  const result = await upsertNotificationPreferenceForRequest(request.headers, data);
  return NextResponse.json(result);
});
