import { formatQuantity } from "@/lib/format";
import type { NegativeStockWarningPayload } from "@/app/(dashboard)/sales/types";

export function stockWarningTitle(warning: NegativeStockWarningPayload) {
  if (warning.reason === "commitment_conflict") {
    return "Ship stock committed elsewhere?";
  }
  if (warning.reason === "commitment_and_negative_stock") {
    return "Ship despite commitment conflict?";
  }
  return "Ship despite shortage?";
}

export function stockWarningDescription(warning: NegativeStockWarningPayload) {
  const requested = formatQuantity(String(warning.requested));
  const available = formatQuantity(String(warning.available));
  const committed = formatQuantity(String(warning.committedToOthers ?? 0));
  const shortage = formatQuantity(String(warning.shortage));

  if (warning.reason === "commitment_conflict") {
    return `${warning.itemName} needs ${requested}. ${available} is free for this order, and ${committed} is already committed to other orders. Shipping will take stock from another order.`;
  }

  if (warning.reason === "commitment_and_negative_stock") {
    return `${warning.itemName} needs ${requested}. ${available} is free for this order, and ${committed} is already committed to other orders. Shipping will take committed stock and still leave a shortage of ${shortage}.`;
  }

  return `${warning.itemName} is short by ${shortage} (${available} free for this order, needs ${requested}). Shipping will drive stock negative.`;
}
