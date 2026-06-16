import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { setNotificationResourceExclusionForRequest } from "@/lib/dal/notifications";
import { setNotificationResourceExclusionSchema } from "@/lib/schemas/notifications";

export const PUT = apiHandler(async (request) => {
  const data = await parseJsonBody(request, setNotificationResourceExclusionSchema);
  const result = await setNotificationResourceExclusionForRequest(
    request.headers,
    data
  );
  return NextResponse.json(result);
});
