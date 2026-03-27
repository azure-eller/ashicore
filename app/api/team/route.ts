import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getTeamPageDataForRequest } from "@/app/(dashboard)/settings/queries";

export const GET = apiHandler(async (request) => {
  const data = await getTeamPageDataForRequest(request.headers);
  return NextResponse.json(data);
});
