import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { insertSupplierSchema } from "@/lib/schemas/suppliers";
import {
  createSupplier,
  deleteSuppliers,
  getSuppliers,
  PurchasingError,
} from "@/app/(dashboard)/purchasing/queries";

const deleteSuppliersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export async function GET() {
  const data = await getSuppliers();
  return NextResponse.json(data);
}

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = insertSupplierSchema.parse(body);
  const supplier = await createSupplier(data);
  return NextResponse.json(supplier, { status: 201 });
});

export const DELETE = apiHandler(async (request) => {
  const body = await request.json();
  const data = deleteSuppliersSchema.parse(body);

  try {
    const result = await deleteSuppliers(data.ids);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});
