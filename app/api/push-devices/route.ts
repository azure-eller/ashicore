import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import {
  registerPushDeviceForRequest,
  removePushDeviceForRequest,
} from "@/lib/dal/notifications";
import {
  registerPushDeviceSchema,
  removePushDeviceSchema,
} from "@/lib/schemas/notifications";

export const POST = apiHandler(async (request) => {
  const data = await parseJsonBody(request, registerPushDeviceSchema);
  const result = await registerPushDeviceForRequest(request.headers, data);
  return NextResponse.json(result);
});

export const DELETE = apiHandler(async (request) => {
  const data = await parseJsonBody(request, removePushDeviceSchema);
  const result = await removePushDeviceForRequest(request.headers, data.token);
  return NextResponse.json(result);
});
