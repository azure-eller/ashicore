// Verifies the opening-stock dual-unit conversion helper.
//
// Pure logic test — no DB, no env. Run with: pnpm verify:opening-stock-conversion
//
// Cases:
//   1. Bare string — qty stored as-is in stock unit.
//   2. Object with stock unit — qty stored as-is, no conversion.
//   3. Object with PURCHASE unit — qty × purchaseToStockFactor.
//   4. Object with unknown unit — throws loudly (silent fallback was the original bug).
//   5. Object with purchase unit but no factor — throws loudly.

import {
  resolveSeedOpeningQuantity,
} from "./load/engine/seeds";
import type { ItemSeed } from "./load/engine/types";

const peatLikeSeed: ItemSeed = {
  key: "peat",
  sku: "TEST-PEAT",
  name: "Test Peat",
  itemType: "material",
  unitKey: "cubic_yard",
  purchaseUnitKey: "bale_225l",
  purchaseToStockFactor: "0.5",
  category: "test",
  description: "test",
};

function assert(condition: unknown, label: string, actual?: unknown) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label} — got: ${JSON.stringify(actual)}`);
    process.exit(1);
  }
}

const c1 = resolveSeedOpeningQuantity(peatLikeSeed, "100");
assert(c1.stockQuantity === 100, "Case 1 (bare string) stockQuantity", c1.stockQuantity);
assert(c1.sourceLabel === "100", "Case 1 sourceLabel", c1.sourceLabel);

const c2 = resolveSeedOpeningQuantity(peatLikeSeed, {
  quantity: "100",
  unitKey: "cubic_yard",
});
assert(c2.stockQuantity === 100, "Case 2 (stock unit) stockQuantity", c2.stockQuantity);
assert(c2.sourceLabel === "100 cubic_yard", "Case 2 sourceLabel", c2.sourceLabel);

const c3 = resolveSeedOpeningQuantity(peatLikeSeed, {
  quantity: "100",
  unitKey: "bale_225l",
});
assert(c3.stockQuantity === 50, "Case 3 (purchase unit) stockQuantity 100×0.5=50", c3.stockQuantity);
assert(
  c3.sourceLabel === "100 bale_225l → 50 cubic_yard",
  "Case 3 sourceLabel preserves origin + result",
  c3.sourceLabel
);

let threw4 = false;
try {
  resolveSeedOpeningQuantity(peatLikeSeed, { quantity: "100", unitKey: "kilogram" });
} catch (err) {
  threw4 = true;
  assert(
    err instanceof Error && err.message.includes("kilogram"),
    "Case 4 error mentions the bad unit",
    err
  );
}
assert(threw4, "Case 4 (unknown unit) threw", threw4);

const noFactorSeed: ItemSeed = { ...peatLikeSeed, purchaseToStockFactor: undefined };
let threw5 = false;
try {
  resolveSeedOpeningQuantity(noFactorSeed, { quantity: "100", unitKey: "bale_225l" });
} catch (err) {
  threw5 = true;
  assert(
    err instanceof Error && err.message.includes("purchaseToStockFactor"),
    "Case 5 error mentions missing factor",
    err
  );
}
assert(threw5, "Case 5 (missing factor) threw", threw5);

console.log("\n✓ All 5 opening-stock conversion cases passed.");
