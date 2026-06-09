import { formatQuantity } from "@/lib/format";
import type { NegativeStockWarningPayload } from "@/app/(dashboard)/sales/types";

export function stockWarningTitle(warning: NegativeStockWarningPayload) {
  if (warning.reason === "queue_conflict") {
    return "Ship stock claimed by earlier demand?";
  }
  if (warning.reason === "queue_conflict_and_negative_stock") {
    return "Ship despite queue conflict?";
  }
  return "Ship despite shortage?";
}

export function stockWarningDescription(warning: NegativeStockWarningPayload) {
  const requested = formatQuantity(String(warning.requested));
  const available = formatQuantity(String(warning.available));
  const claimed = formatQuantity(String(warning.claimedByHigherPriority ?? 0));
  const shortage = formatQuantity(String(warning.shortage));

  if (warning.reason === "queue_conflict") {
    return `${warning.itemName} needs ${requested}. ${available} is covered for this order, and ${claimed} is claimed by earlier demand. Shipping will take stock from another order.`;
  }

  if (warning.reason === "queue_conflict_and_negative_stock") {
    return `${warning.itemName} needs ${requested}. ${available} is covered for this order, and ${claimed} is claimed by earlier demand. Shipping will take earlier-demand stock and still leave a shortage of ${shortage}.`;
  }

  return `${warning.itemName} is short by ${shortage} (${available} covered for this order, needs ${requested}). Shipping will drive stock negative.`;
}
