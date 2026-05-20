import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { patchCustomerSchema, updateCustomerSchema } from "@/lib/schemas/customers";
import {
  deleteCustomer,
  getCustomerDetail,
  patchCustomer,
  SalesError,
  updateCustomer,
} from "@/app/(dashboard)/sales/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const customer = await getCustomerDetail(id, { includeDeleted: true });

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json(customer);
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = patchCustomerSchema.parse(await request.json());
  const customer = await patchCustomer(id, data);

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json(customer);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateCustomerSchema.parse(body);
  const customer = await updateCustomer(id, data);

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json(customer);
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", _request.headers);
  const { id } = await (ctx as RouteContext).params;

  try {
    const result = await deleteCustomer(id);

    if (!result.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    if (process.env.BLOB_READ_WRITE_TOKEN && result.blobUrls.length > 0) {
      await Promise.all(
        result.blobUrls.map((blobUrl) => del(blobUrl).catch(() => undefined))
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
