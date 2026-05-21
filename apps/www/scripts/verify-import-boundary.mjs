import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wwwRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(wwwRoot, "../..");
const scanRoots = ["src", "scripts"].map((dir) => path.join(wwwRoot, dir));
const importPattern =
  /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const forbiddenFragments = [
  "/app/",
  "/components/",
  "/lib/db/",
  "/lib/dal/",
  "/lib/auth",
  "/drizzle/",
  "/scripts/load/",
  "/scripts/local-db",
  "/scripts/setup-local-db",
];

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      files.push(...walk(filePath));
      continue;
    }

    if (/\.(astro|mjs|js|ts|tsx|md|mdx)$/.test(entry.name)) {
      files.push(filePath);
    }
  }

  return files;
}

function normalizeForMatch(filePath) {
  return filePath.split(path.sep).join("/");
}

const failures = [];

for (const root of scanRoots) {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue;

  for (const filePath of walk(root)) {
    const source = readFileSync(filePath, "utf8");
    const relativeFile = path.relative(wwwRoot, filePath);

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;

      if (specifier.startsWith("@/")) {
        failures.push(`${relativeFile}: absolute ERP-style alias import "${specifier}"`);
        continue;
      }

      if (!specifier.startsWith(".")) continue;

      const resolved = path.resolve(path.dirname(filePath), specifier);

      if (!resolved.startsWith(wwwRoot)) {
        failures.push(`${relativeFile}: relative import leaves apps/www: "${specifier}"`);
        continue;
      }

      const normalized = normalizeForMatch(path.relative(repoRoot, resolved));
      if (forbiddenFragments.some((fragment) => `/${normalized}`.includes(fragment))) {
        failures.push(`${relativeFile}: forbidden ERP import "${specifier}"`);
      }
    }
  }
}

if (failures.length) {
  console.error("apps/www import boundary failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("apps/www import boundary verified.");
