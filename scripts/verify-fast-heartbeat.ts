import fs from "node:fs";
import path from "node:path";

const FAST_DIR = path.join(process.cwd(), "test/e2e/fast");
const REGISTRY_PATH = path.join(FAST_DIR, "FAST_TEST_SEAMS.md");
const MAX_FAST_SPEC_FILES = 8;

function listFastSpecs() {
  return fs
    .readdirSync(FAST_DIR)
    .filter((entry) => entry.endsWith(".spec.ts"))
    .sort();
}

function listRegisteredSpecs() {
  const registry = fs.readFileSync(REGISTRY_PATH, "utf8");
  const specs = new Set<string>();
  const pattern = /`([^`]+\.spec\.ts)`/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(registry)) != null) {
    specs.add(path.basename(match[1]));
  }

  return [...specs].sort();
}

function main() {
  const actual = listFastSpecs();
  const registered = listRegisteredSpecs();
  const errors: string[] = [];

  if (actual.length > MAX_FAST_SPEC_FILES) {
    errors.push(
      `test/e2e/fast has ${actual.length} spec files; max is ${MAX_FAST_SPEC_FILES}.`
    );
  }

  const actualSet = new Set(actual);
  const registeredSet = new Set(registered);
  const unregistered = actual.filter((spec) => !registeredSet.has(spec));
  const missing = registered.filter((spec) => !actualSet.has(spec));

  if (unregistered.length > 0) {
    errors.push(`Fast spec(s) missing from FAST_TEST_SEAMS.md: ${unregistered.join(", ")}`);
  }

  if (missing.length > 0) {
    errors.push(`FAST_TEST_SEAMS.md lists missing spec(s): ${missing.join(", ")}`);
  }

  if (errors.length > 0) {
    console.error("Fast heartbeat verification failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Fast heartbeat verification passed.");
}

main();
