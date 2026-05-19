import { AllocationError } from "../errors";
import type { AllocationDemandAdapter, AllocationDemandType } from "../types";
import { manufacturingOrderIngredientAllocationAdapter } from "./manufacturing-order-ingredient";
import { salesOrderLineAllocationAdapter } from "./sales-order-line";
import { salesShipmentLineAllocationAdapter } from "./sales-shipment-line";

const adapters = {
  sales_order_line: salesOrderLineAllocationAdapter,
  sales_shipment_line: salesShipmentLineAllocationAdapter,
  manufacturing_order_ingredient: manufacturingOrderIngredientAllocationAdapter,
} satisfies Record<AllocationDemandType, AllocationDemandAdapter>;

export function getAllocationDemandAdapter(demandType: AllocationDemandType) {
  const adapter = adapters[demandType];
  if (!adapter) {
    throw new AllocationError(`Unsupported allocation demand type: ${demandType}.`);
  }
  return adapter;
}

export const allocationDemandAdapters = Object.values(adapters);
