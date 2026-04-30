import { normalizeNumeric, roundQuantity } from "@/lib/format";

export type ItemCommitmentSlice =
  | { type: "available"; label: "Available"; quantity: string }
  | { type: "customer"; label: string; quantity: string; customerId: string | null }
  | { type: "other_customers"; label: "Other customers"; quantity: string }
  | { type: "other_reserved"; label: "Other reserved"; quantity: string }
  | { type: "unavailable"; label: "Unavailable"; quantity: string };

export type ItemCommitmentSummary = {
  itemId: string;
  onHandQty: string;
  reservableOnHandQty: string;
  availableQty: string;
  committedQty: string;
  demandQty: string;
  shortageQty: string;
  unitName: string | null;
  unitUom: string | null;
  slices: ItemCommitmentSlice[];
};

export type CustomerReservationSummary = {
  customerId: string | null;
  customerName: string | null;
  quantity: string;
};

const MAX_CUSTOMER_SLICES = 5;

function quantityValue(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveQuantity(value: number) {
  return Math.max(0, roundQuantity(value));
}

function addSlice<T extends ItemCommitmentSlice>(
  slices: ItemCommitmentSlice[],
  slice: T,
  quantity: number
) {
  const normalized = positiveQuantity(quantity);
  if (normalized <= 0) return;
  slices.push({ ...slice, quantity: normalizeNumeric(normalized) });
}

export function buildItemCommitmentSlices(params: {
  onHandQty: string;
  reservableOnHandQty: string;
  availableQty: string;
  committedQty: string;
  customerReservations: CustomerReservationSummary[];
}): ItemCommitmentSlice[] {
  const onHandQty = positiveQuantity(quantityValue(params.onHandQty));
  const reservableOnHandQty = Math.min(
    onHandQty,
    positiveQuantity(quantityValue(params.reservableOnHandQty))
  );
  const availableQty = Math.min(
    reservableOnHandQty,
    positiveQuantity(quantityValue(params.availableQty))
  );
  const committedQty = positiveQuantity(quantityValue(params.committedQty));
  const unavailableQty = positiveQuantity(onHandQty - reservableOnHandQty);
  const reservedQtyForChart = Math.min(
    committedQty,
    positiveQuantity(reservableOnHandQty - availableQty)
  );

  const slices: ItemCommitmentSlice[] = [];
  addSlice(slices, { type: "available", label: "Available", quantity: "0" }, availableQty);

  const customers = params.customerReservations
    .map((row) => ({
      customerId: row.customerId,
      label: row.customerName?.trim() || "Unknown customer",
      quantity: positiveQuantity(quantityValue(row.quantity)),
    }))
    .filter((row) => row.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label));

  let remainingReservedQty = reservedQtyForChart;
  const visibleCustomers = customers.slice(0, MAX_CUSTOMER_SLICES);
  const groupedCustomers = customers.slice(MAX_CUSTOMER_SLICES);

  for (const customer of visibleCustomers) {
    const quantity = Math.min(customer.quantity, remainingReservedQty);
    addSlice(
      slices,
      {
        type: "customer",
        label: customer.label,
        quantity: "0",
        customerId: customer.customerId,
      },
      quantity
    );
    remainingReservedQty = positiveQuantity(remainingReservedQty - quantity);
  }

  const groupedCustomerQty = groupedCustomers.reduce(
    (sum, customer) => sum + customer.quantity,
    0
  );
  const otherCustomerQty = Math.min(groupedCustomerQty, remainingReservedQty);
  addSlice(
    slices,
    { type: "other_customers", label: "Other customers", quantity: "0" },
    otherCustomerQty
  );
  remainingReservedQty = positiveQuantity(remainingReservedQty - otherCustomerQty);

  addSlice(
    slices,
    { type: "other_reserved", label: "Other reserved", quantity: "0" },
    remainingReservedQty
  );
  addSlice(
    slices,
    { type: "unavailable", label: "Unavailable", quantity: "0" },
    unavailableQty
  );

  return slices;
}

export function buildItemCommitmentSummary(params: Omit<ItemCommitmentSummary, "slices"> & {
  customerReservations: CustomerReservationSummary[];
}): ItemCommitmentSummary {
  return {
    itemId: params.itemId,
    onHandQty: params.onHandQty,
    reservableOnHandQty: params.reservableOnHandQty,
    availableQty: params.availableQty,
    committedQty: params.committedQty,
    demandQty: params.demandQty,
    shortageQty: params.shortageQty,
    unitName: params.unitName,
    unitUom: params.unitUom,
    slices: buildItemCommitmentSlices(params),
  };
}
