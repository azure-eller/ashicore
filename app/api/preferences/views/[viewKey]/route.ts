import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import {
  getUserViewPreferencePayload,
  saveUserViewPreferencePayload,
} from "@/lib/dal/user-view-preferences";
import { getViewPreferenceDefinition } from "@/lib/view-preferences";

async function getViewKey(ctx: unknown) {
  const { viewKey } = await (ctx as { params: Promise<{ viewKey: string }> }).params;
  return decodeURIComponent(viewKey);
}

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const viewKey = await getViewKey(ctx);
  const definition = getViewPreferenceDefinition(viewKey);
  if (!definition) {
    return jsonNotFound("Unknown view preference.");
  }

  await assertModuleReadAccess(definition.module, request.headers);
  const payload = await getUserViewPreferencePayload(viewKey);
  return NextResponse.json(definition.schema.parse(payload));
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const viewKey = await getViewKey(ctx);
  const definition = getViewPreferenceDefinition(viewKey);
  if (!definition) {
    return jsonNotFound("Unknown view preference.");
  }

  await assertModuleReadAccess(definition.module, request.headers);
  const preference = await parseJsonBody(request, definition.schema);
  const payload = await saveUserViewPreferencePayload(viewKey, preference);
  return NextResponse.json(definition.schema.parse(payload));
});
