import Decimal from "decimal.js-light";
import {
  PRICING_SCENARIO_CALCULATION_VERSION,
  type PricingScenarioDoc,
  type PricingScenarioRevisionProduct,
} from "@/lib/schemas/pricing-scenarios";

const ScenarioDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});
type Dec = InstanceType<typeof ScenarioDecimal>;

export type PricingBaselineLeafItem = {
  itemId: string;
  name: string;
  sku: string | null;
  unitName: string | null;
  baselinePrice: string | null;
};
export type PricingBaselineResource = {
  resourceId: string;
  name: string;
  baselineRate: string | null;
};
export type PricingBaselineProduct = {
  itemId: string;
  name: string;
  sku: string | null;
  unitName: string | null;
  baselineCurrentPrice: string | null;
};
export type PricingBaseline = {
  leafItems: PricingBaselineLeafItem[];
  resources: PricingBaselineResource[];
  products: PricingBaselineProduct[];
};

export type PricingUsageTermsDto = {
  productId: string;
  materialTerms: { itemId: string; quantityPerUnit: string }[];
  laborTerms: {
    resourceId: string | null;
    hoursPerUnit: string;
    fallbackRatePerHour: string | null;
  }[];
  issues: string[];
};

export type PricingScenarioCalculationInput = {
  baseline: PricingBaseline;
  usageTerms: PricingUsageTermsDto[];
  doc: PricingScenarioDoc;
};

export type PricingScenarioCalculation = {
  calculationVersion: typeof PRICING_SCENARIO_CALCULATION_VERSION;
  products: PricingScenarioRevisionProduct[];
};

function parseDecimal(value: string | null | undefined): Dec | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  try {
    const parsed = new ScenarioDecimal(value.trim());
    return parsed.isNegative() ? null : parsed;
  } catch {
    return null;
  }
}

function money(value: Dec): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

const USAGE_ISSUE_MESSAGES: Record<string, string> = {
  cycle: "Recipe contains a circular reference",
  invalid_quantity: "Recipe contains an invalid quantity",
  invalid_batch_denominator: "Batch operation has no valid batch size",
  missing_component: "Recipe references a missing component",
};

export function calculatePricingScenario(
  input: PricingScenarioCalculationInput
): PricingScenarioCalculation {
  const { baseline, usageTerms, doc } = input;

  const leafById = new Map(baseline.leafItems.map((leaf) => [leaf.itemId, leaf]));
  const resourceById = new Map(
    baseline.resources.map((resource) => [resource.resourceId, resource])
  );
  const productById = new Map(
    baseline.products.map((product) => [product.itemId, product])
  );
  const usageByProductId = new Map(usageTerms.map((usage) => [usage.productId, usage]));
  const materialOverrides = new Map(doc.materials.map((row) => [row.itemId, row]));
  const rateOverrides = new Map(doc.resourceRates.map((row) => [row.resourceId, row]));
  const productValues = new Map(doc.products.map((row) => [row.itemId, row]));

  const overheadRate = (parseDecimal(doc.overheadPercent) ?? new ScenarioDecimal(0)).div(100);
  const targetProfitRate = (
    parseDecimal(doc.targetProfitPercent) ?? new ScenarioDecimal(0)
  ).div(100);
  // Overhead and profit are both shares of the selling price, so the price is
  // cost divided by the leftover share: price = cost ÷ (1 − overhead − profit).
  const shareDenominator = new ScenarioDecimal(1)
    .minus(overheadRate)
    .minus(targetProfitRate);

  const products: PricingScenarioRevisionProduct[] = doc.productIds.map((productId) => {
    const meta = productById.get(productId);
    const usage = usageByProductId.get(productId);
    const values = productValues.get(productId);
    const issues: string[] = [];

    const name = meta?.name ?? "Unknown product";
    const sku = meta?.sku ?? null;

    if (!usage) {
      issues.push("Product is missing from the current recipe data");
    }
    for (const issue of usage?.issues ?? []) {
      issues.push(USAGE_ISSUE_MESSAGES[issue] ?? `Recipe issue: ${issue}`);
    }

    let materialsTotal = new ScenarioDecimal(0);
    let inboundFreightTotal = new ScenarioDecimal(0);
    const materialRows: PricingScenarioRevisionProduct["materials"] = [];

    for (const term of usage?.materialTerms ?? []) {
      const leaf = leafById.get(term.itemId);
      const override = materialOverrides.get(term.itemId);
      const overridePrice = parseDecimal(override?.price);
      const baselinePrice = parseDecimal(leaf?.baselinePrice);
      const unitPrice = overridePrice ?? baselinePrice;
      const quantity = parseDecimal(term.quantityPerUnit);
      const inboundFreight = parseDecimal(override?.inboundFreight);

      if (quantity == null) {
        issues.push(`Invalid quantity for ${leaf?.name ?? term.itemId}`);
        continue;
      }
      if (unitPrice == null) {
        issues.push(`Missing price: ${leaf?.name ?? term.itemId}`);
      } else {
        materialsTotal = materialsTotal.plus(quantity.times(unitPrice));
      }
      if (inboundFreight != null) {
        inboundFreightTotal = inboundFreightTotal.plus(quantity.times(inboundFreight));
      }

      const landedRate =
        unitPrice == null
          ? null
          : unitPrice.plus(inboundFreight ?? new ScenarioDecimal(0));

      materialRows.push({
        itemId: term.itemId,
        name: leaf?.name ?? "Unknown item",
        sku: leaf?.sku ?? null,
        quantityPerUnit: term.quantityPerUnit,
        unitPrice: unitPrice == null ? null : unitPrice.toString(),
        inboundFreight: inboundFreight == null ? null : inboundFreight.toString(),
        priceSource: overridePrice != null ? "override" : "baseline",
        costPerUnit: landedRate == null ? null : money(quantity.times(landedRate)),
      });
    }

    let laborTotal = new ScenarioDecimal(0);
    const laborRows: PricingScenarioRevisionProduct["labor"] = [];

    for (const term of usage?.laborTerms ?? []) {
      const resource = term.resourceId ? resourceById.get(term.resourceId) : null;
      const override = term.resourceId
        ? parseDecimal(rateOverrides.get(term.resourceId)?.rate)
        : null;
      const rate =
        override ??
        parseDecimal(resource?.baselineRate) ??
        parseDecimal(term.fallbackRatePerHour);
      const hours = parseDecimal(term.hoursPerUnit);

      if (hours == null) {
        issues.push(`Invalid operation hours for ${resource?.name ?? "operations"}`);
        continue;
      }
      if (rate == null) {
        issues.push(`Missing rate: ${resource?.name ?? "unassigned operations"}`);
      } else {
        laborTotal = laborTotal.plus(hours.times(rate));
      }

      laborRows.push({
        resourceId: term.resourceId,
        name: resource?.name ?? "Unassigned",
        hoursPerUnit: term.hoursPerUnit,
        rate: rate == null ? null : rate.toString(),
        rateSource: override != null ? "override" : "baseline",
        costPerUnit: rate == null ? null : money(hours.times(rate)),
      });
    }

    // Freight is entered as a shipment total for a tote count and divided down
    // to a per-tote cost that joins the cost base.
    const outboundFreightCost = parseDecimal(values?.outboundFreightCost);
    const outboundFreightTotes = parseDecimal(values?.outboundFreightTotes);
    const outboundFreight =
      outboundFreightCost != null &&
      outboundFreightTotes != null &&
      outboundFreightTotes.gt(0)
        ? outboundFreightCost.div(outboundFreightTotes)
        : null;
    const currentPriceOverride = parseDecimal(values?.currentPrice);
    const currentPrice =
      currentPriceOverride ?? parseDecimal(meta?.baselineCurrentPrice);
    const currentPriceSource: "baseline" | "override" =
      currentPriceOverride != null ? "override" : "baseline";

    if (shareDenominator.lte(0)) {
      issues.push("Overhead plus target profit must be below 100%");
    }

    const complete = issues.length === 0;
    const directCost = materialsTotal.plus(inboundFreightTotal).plus(laborTotal);
    const costToRecover = directCost.plus(outboundFreight ?? new ScenarioDecimal(0));

    const buckets = {
      materials: complete ? money(materialsTotal) : null,
      inboundFreight: complete ? money(inboundFreightTotal) : null,
      labor: complete ? money(laborTotal) : null,
      directCost: complete ? money(directCost) : null,
      costToRecover: complete ? money(costToRecover) : null,
    };

    const freightFields = {
      outboundFreight: outboundFreight == null ? null : outboundFreight.toString(),
      outboundFreightCost:
        outboundFreightCost == null ? null : outboundFreightCost.toString(),
      outboundFreightTotes:
        outboundFreightTotes == null ? null : outboundFreightTotes.toString(),
    };

    if (!complete) {
      return {
        itemId: productId,
        name,
        sku,
        materials: materialRows,
        labor: laborRows,
        buckets,
        ...freightFields,
        currentPrice: currentPrice == null ? null : currentPrice.toString(),
        currentPriceSource,
        result: { withheld: true as const, issues },
      };
    }

    // Share model: overhead and profit are both slices of the selling price.
    const sellAt = costToRecover.div(shareDenominator);
    const overheadDollars = sellAt.times(overheadRate);
    const profitDollars = sellAt.times(targetProfitRate);
    // Fully-loaded cost before profit (cost base plus the overhead it must carry).
    const newCost = sellAt.minus(profitDollars);

    // Margin actually earned at the current price. Overhead scales with price, so
    // it must be recomputed against currentPrice rather than the recommended one.
    let currentMargin: string | null = null;
    if (currentPrice != null && currentPrice.gt(0)) {
      const loadedCostAtCurrent = costToRecover.plus(currentPrice.times(overheadRate));
      currentMargin = currentPrice
        .minus(loadedCostAtCurrent)
        .div(currentPrice)
        .times(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toString();
    }

    return {
      itemId: productId,
      name,
      sku,
      materials: materialRows,
      labor: laborRows,
      buckets,
      ...freightFields,
      currentPrice: currentPrice == null ? null : currentPrice.toString(),
      currentPriceSource,
      result: {
        withheld: false as const,
        sellAt: money(sellAt),
        newCost: money(newCost),
        overheadDollars: money(overheadDollars),
        profitDollars: money(profitDollars),
        currentMargin,
      },
    };
  });

  return { calculationVersion: PRICING_SCENARIO_CALCULATION_VERSION, products };
}
