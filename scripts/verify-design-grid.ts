import { readFileSync } from "node:fs";

/**
 * The app's spacing, height, leading, and type tokens must stay on an exact
 * grid.
 *
 * History: a June redesign scaled --space by 1.25x and --text by 1.18x, on the
 * belief that design handoffs were authored on a small canvas and had to be
 * scaled up. They were not — the handoffs specify literal 1:1 px for a 1440px
 * screen. A later pass pulled type back by 0.82x but left spacing at 1.25x.
 * Two roundings plus that asymmetry left the scale off-grid (11 and 12 both
 * existed; 15 and 16 both existed; 33 not 32; 41 not 40) and gave the type
 * scale seven values between 13px and 16px, close enough to be perceptually
 * identical but different enough to break alignment.
 *
 * The visible symptom is an app that reads as unfinished: controls that should
 * line up sit a pixel apart, and size changes read as inconsistency rather
 * than hierarchy. This guard stops that drift returning.
 */

const THEME_FILE = "app/styles/theme.css";

const SPACE_SUB_STEPS = new Set([2, 6]);
// Below this ratio two type sizes are perceptually identical (13.5 -> 14 is 3.7%).
const MIN_TYPE_GAP_RATIO = 1.08;

const source = readFileSync(THEME_FILE, "utf8");

const declarationEntries = [
  ...source.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm),
].map(([, name, value]) => [name, value.trim()] as const);
const declarations = new Map(declarationEntries);

type ResolvedToken = { value: number } | { error: string };

function resolveToken(name: string, resolving = new Set<string>()): ResolvedToken {
  const rawValue = declarations.get(name);

  if (rawValue === undefined) {
    return { error: `${name} is not declared` };
  }

  return resolveValue(name, rawValue, resolving);
}

function resolveValue(
  name: string,
  rawValue: string,
  resolving = new Set<string>()
): ResolvedToken {
  if (/^0(?:\.0+)?$/.test(rawValue)) {
    return { value: 0 };
  }

  const pixelValue = rawValue.match(/^([0-9]+(?:\.[0-9]+)?)px$/);
  if (pixelValue) {
    const value = Number.parseFloat(pixelValue[1]);
    return value > 0
      ? { value }
      : { error: `${rawValue} must be a positive px value` };
  }

  const alias = rawValue.match(/^var\((--[a-z0-9-]+)\)$/);
  if (alias) {
    if (resolving.has(name)) {
      return { error: `alias cycle includes ${name}` };
    }

    return resolveToken(alias[1], new Set(resolving).add(name));
  }

  return { error: `${rawValue} is not a px value or resolvable token alias` };
}

function declaredTokens(prefix: string) {
  return declarationEntries
    .filter(([name]) => name.startsWith(prefix))
    .map(([name, rawValue]) => ({ name, resolved: resolveValue(name, rawValue) }));
}

const violations: string[] = [];

function resolvedTokens(prefix: string) {
  return declaredTokens(prefix).flatMap(({ name, resolved }) => {
    if ("error" in resolved) {
      violations.push(`${name}: ${resolved.error}`);
      return [];
    }

    return [{ name, value: resolved.value }];
  });
}

for (const { name, value } of resolvedTokens("--space-")) {
  if (value % 4 !== 0 && !SPACE_SUB_STEPS.has(value)) {
    violations.push(`${name}: ${value}px is off the 4px spacing grid`);
  }
}

for (const { name, value } of resolvedTokens("--height-")) {
  if (value % 4 !== 0) {
    violations.push(`${name}: ${value}px is off the 4px height grid`);
  }
}

for (const { name, value } of resolvedTokens("--leading-")) {
  if (value % 4 !== 0) {
    violations.push(`${name}: ${value}px breaks the 4px vertical rhythm`);
  }
}

const typeSizes = [...new Set(resolvedTokens("--text-").map((t) => t.value))].sort(
  (a, b) => a - b
);

for (let i = 1; i < typeSizes.length; i += 1) {
  const ratio = typeSizes[i] / typeSizes[i - 1];
  if (ratio < MIN_TYPE_GAP_RATIO) {
    const pct = ((ratio - 1) * 100).toFixed(1);
    violations.push(
      `type steps ${typeSizes[i - 1]}px -> ${typeSizes[i]}px are only ${pct}% apart; ` +
        `sizes closer than ${((MIN_TYPE_GAP_RATIO - 1) * 100).toFixed(0)}% read as inconsistency, not hierarchy`
    );
  }
}

if (violations.length > 0) {
  console.error("Design grid verification failed.");
  console.error(`Token values in ${THEME_FILE} must stay on the shared grid.`);

  for (const violation of violations) {
    console.error(`- ${violation}`);
  }

  process.exit(1);
}

console.log("Design grid verification passed.");
