import fs from "node:fs";
import path from "node:path";

const SLOW_DIR = path.join(process.cwd(), "test/e2e/slow");
const REGISTRY_PATH = path.join(SLOW_DIR, "SLOW_TEST_STORIES.md");
const MAX_SLOW_SPEC_FILES = 9;

type RegistryRow = {
  file: string;
  lane: string;
  activeTests: number;
  justification: string;
};

function parseTableCells(line: string) {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function listSlowSpecs() {
  return fs
    .readdirSync(SLOW_DIR)
    .filter((entry) => entry.endsWith(".spec.ts"))
    .sort();
}

function parseRegistry() {
  const registry = fs.readFileSync(REGISTRY_PATH, "utf8");
  const rows: RegistryRow[] = [];
  const lines = registry.split("\n");
  const headerLine = lines.find((line) => line.startsWith("| File |"));
  if (!headerLine) return rows;

  const headers = parseTableCells(headerLine);
  const column = (name: string) => headers.indexOf(name);
  const fileColumn = column("File");
  const laneColumn = column("Lane");
  const activeTestsColumn = column("Active tests");
  const justificationColumn = column("Justification");

  if (
    fileColumn === -1 ||
    laneColumn === -1 ||
    activeTestsColumn === -1 ||
    justificationColumn === -1
  ) {
    return rows;
  }

  for (const line of lines) {
    if (!line.startsWith("| `") || line.includes("---")) continue;

    const cells = parseTableCells(line);
    const file = cells[fileColumn]?.match(/`([^`]+\.spec\.ts)`/)?.[1];
    const lane = cells[laneColumn] ?? "";
    const activeTests = Number(cells[activeTestsColumn] ?? "NaN");
    const justification = cells[justificationColumn] ?? "";

    if (file) {
      rows.push({ file: path.basename(file), lane, activeTests, justification });
    }
  }

  return rows.sort((a, b) => a.file.localeCompare(b.file));
}

function countActiveTests(specFile: string) {
  const source = fs.readFileSync(path.join(SLOW_DIR, specFile), "utf8");
  return source
    .split("\n")
    .filter((line) => /^\s*test\(/.test(line))
    .length;
}

function findForbiddenTestModifiers(specFile: string) {
  const source = fs.readFileSync(path.join(SLOW_DIR, specFile), "utf8");
  const forbidden = /^\s*test\.(only|skip|fixme)\(/;
  return source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => forbidden.test(line))
    .map(({ number, line }) => `${specFile}:${number}: ${line.trim()}`);
}

function main() {
  const actual = listSlowSpecs();
  const registryRows = parseRegistry();
  const registered = registryRows.map((row) => row.file).sort();
  const errors: string[] = [];

  if (actual.length > MAX_SLOW_SPEC_FILES) {
    errors.push(
      `test/e2e/slow has ${actual.length} spec files; max is ${MAX_SLOW_SPEC_FILES}.`
    );
  }

  if (registryRows.length === 0) {
    errors.push("SLOW_TEST_STORIES.md did not parse any registry rows.");
  }

  const actualSet = new Set(actual);
  const registeredSet = new Set(registered);
  const unregistered = actual.filter((spec) => !registeredSet.has(spec));
  const missing = registered.filter((spec) => !actualSet.has(spec));

  if (unregistered.length > 0) {
    errors.push(`Slow spec(s) missing from SLOW_TEST_STORIES.md: ${unregistered.join(", ")}`);
  }

  if (missing.length > 0) {
    errors.push(`SLOW_TEST_STORIES.md lists missing spec(s): ${missing.join(", ")}`);
  }

  for (const row of registryRows) {
    if (!Number.isInteger(row.activeTests) || row.activeTests < 0) {
      errors.push(`${row.file} has invalid Active tests value: ${row.activeTests}.`);
      continue;
    }

    if (actualSet.has(row.file)) {
      const activeTests = countActiveTests(row.file);
      if (activeTests !== row.activeTests) {
        errors.push(
          `${row.file} has ${activeTests} active test() blocks, registry says ${row.activeTests}.`
        );
      }
    }

    if (row.activeTests > 8 && row.justification.trim() === "") {
      errors.push(`${row.file} has more than 8 active tests without justification.`);
    }
  }

  for (const spec of actual) {
    const forbidden = findForbiddenTestModifiers(spec);
    if (forbidden.length > 0) {
      errors.push(
        `Slow specs must not use test.only/test.skip/test.fixme:\n${forbidden.join("\n")}`
      );
    }
  }

  const lanes = new Map<string, RegistryRow[]>();
  for (const row of registryRows) {
    lanes.set(row.lane, [...(lanes.get(row.lane) ?? []), row]);
  }

  for (const [lane, rows] of lanes.entries()) {
    if (rows.length > 1) {
      const withoutJustification = rows.filter((row) => row.justification.trim() === "");
      if (withoutJustification.length > 0) {
        errors.push(
          `Slow lane "${lane}" has multiple files; each row needs justification. Missing: ${withoutJustification
            .map((row) => row.file)
            .join(", ")}.`
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error("Slow story verification failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Slow story verification passed.");
}

main();
