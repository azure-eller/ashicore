import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerProjectSchema } from "@/lib/schemas/customer-crm";
import {
  deleteCustomerProject,
  updateCustomerProject,
} from "@/app/(dashboard)/sales/queries";

type ProjectRouteContext = {
  params: Promise<{ id: string; projectId: string }>;
};

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId } = await (ctx as ProjectRouteContext).params;
  const data = customerProjectSchema.parse(await request.json());
  const project = await updateCustomerProject(id, projectId, data);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, projectId } = await (ctx as ProjectRouteContext).params;
  const result = await deleteCustomerProject(id, projectId);

  if (!result.deleted) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (process.env.BLOB_READ_WRITE_TOKEN && result.blobUrls.length > 0) {
    await Promise.all(result.blobUrls.map((blobUrl) => del(blobUrl).catch(() => undefined)));
  }

  return NextResponse.json({ success: true });
});
