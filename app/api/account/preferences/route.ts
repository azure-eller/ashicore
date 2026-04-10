import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { updateReadabilitySchema } from "@/lib/schemas/account";
import { upsertUserReadability } from "@/app/(dashboard)/settings/queries";

export const PATCH = apiHandler(async (request) => {
  const body = await request.json();
  const { readability } = updateReadabilitySchema.parse(body);

  await upsertUserReadability(request.headers, readability);

  const response = NextResponse.json({ readability });
  response.cookies.set("readability", readability, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: false,
    sameSite: "lax",
  });

  return response;
});
