import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { AllocationError } from "@/lib/inventory/allocation/errors";
import {
  bulkAllocateOpenSalesOrdersFifo,
  bulkUnallocateOpenSalesOrders,
} from "@/lib/inventory/allocation/sales-bulk";

const bulkSalesAllocationSchema = z.object({
  action: z.enum(["allocate_fifo", "unallocate_open"]),
});

export const POST = apiHandler(async (request: Request) => {
  const input = bulkSalesAllocationSchema.parse(await request.json());
  await assertModuleWriteAccess("sales", request.headers);

  try {
    const result =
      input.action === "allocate_fifo"
        ? await bulkAllocateOpenSalesOrdersFifo()
        : await bulkUnallocateOpenSalesOrders();
    return NextResponse.json({ action: input.action, ...result });
  } catch (error) {
    if (error instanceof AllocationError) return error.toResponse();
    throw error;
  }
});
