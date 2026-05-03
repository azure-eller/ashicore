import assert from "node:assert/strict";
import { z } from "zod";
import {
  nonNegativeDecimalString,
  nullableStringPreserveUndefined,
  optionalMoneyString,
  optionalNonNegativeDecimalString,
  positiveDecimalString,
  positiveMoneyString,
} from "@/lib/schemas/shared";

function assertParse<T>(actual: T, expected: T) {
  assert.deepEqual(actual, expected);
}

const preserveUndefined = nullableStringPreserveUndefined;
assertParse(preserveUndefined.parse(undefined), undefined);
assert.deepEqual(z.object({ value: preserveUndefined }).parse({}), {});
assertParse(preserveUndefined.parse(null), null);
assertParse(preserveUndefined.parse(""), null);
assertParse(preserveUndefined.parse("  value  "), "value");

const optionalDecimal = optionalNonNegativeDecimalString("Quantity");
assertParse(optionalDecimal.parse(undefined), null);
assertParse(optionalDecimal.parse(""), null);
assertParse(optionalDecimal.parse(" 0 "), "0");
assertParse(optionalDecimal.parse(" 1.25 "), "1.25");
assert.equal(optionalDecimal.safeParse("-1").success, false);
assert.equal(optionalDecimal.safeParse(1).success, false);

const nonNegativeDecimal = nonNegativeDecimalString("Quantity");
assertParse(nonNegativeDecimal.parse(" 0 "), "0");
assertParse(nonNegativeDecimal.parse(" 1.25 "), "1.25");
assert.equal(nonNegativeDecimal.safeParse("").success, false);
assert.equal(nonNegativeDecimal.safeParse("-1").success, false);
assert.equal(nonNegativeDecimal.safeParse(1).success, false);

const positiveDecimal = positiveDecimalString("Quantity");
assertParse(positiveDecimal.parse(" 1.25 "), "1.25");
assert.equal(positiveDecimal.safeParse("0").success, false);
assert.equal(positiveDecimal.safeParse("-1").success, false);
assert.equal(positiveDecimal.safeParse(1).success, false);

const optionalMoney = optionalMoneyString();
assertParse(optionalMoney.parse(undefined), null);
assertParse(optionalMoney.parse(""), null);
assertParse(optionalMoney.parse(" 0 "), "0");
assertParse(optionalMoney.parse(" 1.50 "), "1.5");
assert.equal(optionalMoney.safeParse("-1").success, false);
assert.equal(optionalMoney.safeParse(1).success, false);

const positiveMoney = positiveMoneyString();
assertParse(positiveMoney.parse(" 1.50 "), "1.5");
assert.equal(positiveMoney.safeParse("  ").success, false);
assert.equal(positiveMoney.safeParse("0").success, false);
assert.equal(positiveMoney.safeParse("-1").success, false);
assert.equal(positiveMoney.safeParse(1).success, false);

console.info("Schema helper verification passed.");
