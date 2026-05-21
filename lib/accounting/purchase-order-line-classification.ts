import { normalizeNumeric } from "@/lib/format";

type ExternalPurchaseOrderLineLike = {
  itemCode: string | null;
  description: string | null;
  quantity: number | null;
  unitAmount: number | null;
  accountCode: string | null;
};

export type ImportedAdditionalCostLine = {
  costType: "shipping" | "customs" | "other";
  reference: string | null;
  distributionMethod: "by_value" | "not_distributed";
  accountingPurchaseAccountCode: string | null;
  amount: string;
};

function lineText(line: ExternalPurchaseOrderLineLike) {
  return `${line.itemCode ?? ""} ${line.description ?? ""}`.toLowerCase();
}

function lineAmount(line: ExternalPurchaseOrderLineLike) {
  if (
    line.quantity == null ||
    !Number.isFinite(line.quantity) ||
    line.unitAmount == null ||
    !Number.isFinite(line.unitAmount)
  ) {
    return null;
  }

  const amount = line.quantity * line.unitAmount;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function classifyImportedPurchaseOrderChargeLine(
  line: ExternalPurchaseOrderLineLike
): ImportedAdditionalCostLine | null {
  const amount = lineAmount(line);
  if (amount == null) return null;

  const text = lineText(line);
  const reference = line.description?.trim() || line.itemCode?.trim() || null;

  if (/\b(ship|shipping|freight|delivery|transport|logistics)\b/.test(text)) {
    return {
      costType: "shipping",
      reference,
      distributionMethod: "by_value",
      accountingPurchaseAccountCode: line.accountCode,
      amount: normalizeNumeric(amount),
    };
  }

  if (/\b(customs?|duty|duties|tariff|import charge|import fee)\b/.test(text)) {
    return {
      costType: "customs",
      reference,
      distributionMethod: "by_value",
      accountingPurchaseAccountCode: line.accountCode,
      amount: normalizeNumeric(amount),
    };
  }

  if (/\b(handling|surcharge|fee|fuel|brokerage|clearance)\b/.test(text)) {
    return {
      costType: "other",
      reference,
      distributionMethod: "by_value",
      accountingPurchaseAccountCode: line.accountCode,
      amount: normalizeNumeric(amount),
    };
  }

  if (/\b(discount|adjustment|rounding)\b/.test(text)) {
    return {
      costType: "other",
      reference,
      distributionMethod: "not_distributed",
      accountingPurchaseAccountCode: line.accountCode,
      amount: normalizeNumeric(amount),
    };
  }

  return null;
}

export function isImportedPurchaseOrderChargeLine(
  line: ExternalPurchaseOrderLineLike
) {
  return classifyImportedPurchaseOrderChargeLine(line) != null;
}
