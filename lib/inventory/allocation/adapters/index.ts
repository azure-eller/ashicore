import { AllocationError } from "../errors";
import type { AllocationDemandAdapter, AllocationDemandType } from "../types";
import { salesOrderLineAllocationAdapter } from "./sales-order-line";

const adapters = {
  sales_order_line: salesOrderLineAllocationAdapter,
} satisfies Record<AllocationDemandType, AllocationDemandAdapter>;

export function getAllocationDemandAdapter(demandType: AllocationDemandType) {
  const adapter = adapters[demandType];
  if (!adapter) {
    throw new AllocationError(`Unsupported allocation demand type: ${demandType}.`);
  }
  return adapter;
}

export const allocationDemandAdapters = Object.values(adapters);
