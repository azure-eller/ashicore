import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  getOrganizationAllocationModeForRequest,
  updateOrganizationAllocationMode,
} from "@/lib/dal/organization";
import { updateAllocationModeSchema } from "@/lib/schemas/organization";

export const GET = apiHandler(async (request: Request) => {
  const data = await getOrganizationAllocationModeForRequest(request.headers);
  return NextResponse.json(data);
});

export const PATCH = apiHandler(async (request: Request) => {
  const { allocationMode } = updateAllocationModeSchema.parse(await request.json());
  const data = await updateOrganizationAllocationMode(request.headers, allocationMode);
  return NextResponse.json(data);
});
