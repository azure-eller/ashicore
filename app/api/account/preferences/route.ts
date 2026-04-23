import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { updateReadabilitySchema } from "@/lib/schemas/account";
import {
  getUserReadabilityForRequest,
  upsertUserReadability,
} from "@/app/(dashboard)/settings/queries";

function setReadabilityCookie(response: NextResponse, readability: string) {
  response.cookies.set("readability", readability, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
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
