import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  LEGACY_READABILITY_COOKIE_NAME,
  READABILITY_COOKIE_MAX_AGE,
  READABILITY_COOKIE_NAME,
} from "@/lib/readability-cookie";
import { updateReadabilitySchema } from "@/lib/schemas/account";
import {
  getUserReadabilityForRequest,
  upsertUserReadability,
} from "@/app/(dashboard)/settings/queries";

function setReadabilityCookie(response: NextResponse, readability: string) {
  response.cookies.set(READABILITY_COOKIE_NAME, readability, {
    path: "/",
    maxAge: READABILITY_COOKIE_MAX_AGE,
    httpOnly: false,
    sameSite: "lax",
  });
  response.cookies.set(LEGACY_READABILITY_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: false,
    sameSite: "lax",
  });
}

export const GET = apiHandler(async (request) => {
  const readability = await getUserReadabilityForRequest(request.headers);
  const response = NextResponse.json({ readability });
  setReadabilityCookie(response, readability);

  return response;
});

export const PATCH = apiHandler(async (request) => {
  const body = await request.json();
  const { readability } = updateReadabilitySchema.parse(body);

  await upsertUserReadability(request.headers, readability);

  const response = NextResponse.json({ readability });
  setReadabilityCookie(response, readability);

  return response;
});
