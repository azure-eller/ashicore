import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type SuiteExpectation = {
  input?: string;
};

type ChildSummary = {
  counts?: Record<string, number>;
  failures?: Array<{ check: string; message: string }>;
  stage?: string;
  error?: string;
};

const DEFAULT_SCENARIO_DIR = "test/scenarios/onboarding-import-eval";
const DEFAULT_OUT_DIR = ".tmp/onboarding-import-eval-suite";
const INPUT_EXTENSIONS = [".xlsx", ".xls", ".csv", ".pdf", ".png", ".jpg", ".jpeg"];

function usage() {
  return [
    "Usage: pnpm eval:onboarding-import:all [-- <scenario-dir>] [--out <dir>] [--repeat <count>]",
    "",
    "Runs every *.expect.json file in the scenario directory through pnpm eval:onboarding-import.",
  ].join("\n");
}

function expandHome(filePath: string) {
  if (filePath === "~") return process.env.HOME ?? filePath;
  if (filePath.startsWith("~/")) return path.join(process.env.HOME ?? "~", filePath.slice(2));
  return filePath;
}

function parseArgs(argv: string[]) {
  const args = argv.filter((arg) => arg !== "--");
  const parsed = {
    scenarioDir: DEFAULT_SCENARIO_DIR,
    outDir: DEFAULT_OUT_DIR,
    repeat: 1,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    }
    if (arg === "--out") {
      parsed.outDir = args[++index] ?? "";
      continue;
    }
    if (arg === "--repeat") {
      parsed.repeat = Number(args[++index] ?? "");
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    }
    if (parsed.scenarioDir !== DEFAULT_SCENARIO_DIR) {
      throw new Error(`Unexpected extra argument: ${arg}\n${usage()}`);
    }
    parsed.scenarioDir = arg;
  }

  if (!parsed.outDir || !Number.isInteger(parsed.repeat) || parsed.repeat < 1) {
    throw new Error(usage());
  }
  return parsed;
}

function readExpectation(expectPath: string) {
  return JSON.parse(fs.readFileSync(expectPath, "utf8")) as SuiteExpectation;
}

function inferInputPath(expectPath: string, expectation: SuiteExpectation) {
  if (expectation.input) {
    return path.resolve(expandHome(expectation.input));
  }

  const dir = path.dirname(expectPath);
  const baseName = path.basename(expectPath, ".expect.json");
  const candidate = INPUT_EXTENSIONS
    .map((extension) => path.join(dir, `${baseName}${extension}`))
    .find((filePath) => fs.existsSync(filePath));
  if (!candidate) {
    throw new Error(`No input file found for ${expectPath}. Add "input" to the expectation or create a sidecar file.`);
  }
  return path.resolve(candidate);
}

function suiteRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function listDirectories(dir: string) {
  if (!fs.existsSync(dir)) return new Set<string>();
  return new Set(
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name)),
  );
}

function newDirectory(before: Set<string>, after: Set<string>) {
  const created = [...after].filter((dir) => !before.has(dir)).sort();
  return created.at(-1) ?? null;
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readChildSummary(artifactDir: string | null): ChildSummary | null {
  if (!artifactDir) return null;
  const summaryPath = path.join(artifactDir, "summary.json");
  if (!fs.existsSync(summaryPath)) return null;
  return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as ChildSummary;
}

function countRanges(summaries: Array<ChildSummary | null>) {
  const keys = new Set<string>();
  for (const summary of summaries) {
    for (const key of Object.keys(summary?.counts ?? {})) {
      keys.add(key);
    }
  }

  const ranges: Record<string, { min: number; max: number }> = {};
  for (const key of [...keys].sort()) {
    const values = summaries
      .map((summary) => summary?.counts?.[key])
      .filter((value): value is number => typeof value === "number");
    ranges[key] = {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }
  return ranges;
}

function scenarioKey(expectation: string) {
  return expectation;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarioDir = path.resolve(args.scenarioDir);
  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Scenario directory not found: ${scenarioDir}`);
  }

  const expectPaths = fs
    .readdirSync(scenarioDir)
    .filter((fileName) => fileName.endsWith(".expect.json"))
    .sort()
    .map((fileName) => path.join(scenarioDir, fileName));
  if (expectPaths.length === 0) {
    throw new Error(`No *.expect.json files found in ${scenarioDir}`);
  }

  const outDir = path.resolve(args.outDir, suiteRunId());
  fs.mkdirSync(outDir, { recursive: true });

  const results: Array<{
    expectation: string;
    input: string;
    run: number;
    status: "passed" | "failed";
    artifactDir: string | null;
    counts?: Record<string, number>;
    failures?: Array<{ check: string; message: string }>;
    error?: string;
  }> = [];

  for (let run = 1; run <= args.repeat; run += 1) {
    for (const expectPath of expectPaths) {
      const expectation = readExpectation(expectPath);
      const inputPath = inferInputPath(expectPath, expectation);
      const relativeExpectPath = path.relative(process.cwd(), expectPath);
      const relativeInputPath = path.relative(process.cwd(), inputPath);
      const before = listDirectories(outDir);

      console.log(`\n== ${relativeExpectPath} (${run}/${args.repeat}) ==`);
      console.log(`input: ${relativeInputPath.startsWith("..") ? inputPath : relativeInputPath}`);

      const result = spawnSync(
        "pnpm",
        ["eval:onboarding-import", "--", inputPath, "--expect", expectPath, "--out", outDir],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: "inherit",
        },
      );
      const after = listDirectories(outDir);
      const status = result.status === 0 ? "passed" : "failed";
      const artifactDir = newDirectory(before, after);
      const childSummary = readChildSummary(artifactDir);
      results.push({
        expectation: relativeExpectPath,
        input: inputPath,
        run,
        status,
        artifactDir,
        counts: childSummary?.counts,
        failures: childSummary?.failures,
        error: childSummary?.error,
      });
    }
  }

  const failed = results.filter((result) => result.status === "failed");
  const scenarioResults = expectPaths.map((expectPath) => {
    const key = scenarioKey(path.relative(process.cwd(), expectPath));
    const runs = results.filter((result) => result.expectation === key);
    const failedRuns = runs.filter((result) => result.status === "failed");
    return {
      expectation: key,
      status: failedRuns.length === 0 ? "passed" : "failed",
      passed: runs.length - failedRuns.length,
      failed: failedRuns.length,
      total: runs.length,
      countRanges: countRanges(runs),
    };
  });
  const summary = {
    scenarioDir,
    outDir,
    status: failed.length === 0 ? "passed" : "failed",
    repeat: args.repeat,
    passed: results.length - failed.length,
    failed: failed.length,
    total: results.length,
    counts: {
      passed: results.length - failed.length,
      failed: failed.length,
      total: results.length,
    },
    scenarios: scenarioResults,
    results,
  };
  writeJson(path.join(outDir, "summary.json"), summary);

  console.log("\nOnboarding import eval suite:");
  for (const result of scenarioResults) {
    console.log(`- ${result.status}: ${result.expectation} (${result.passed}/${result.total} passed)`);
  }
  console.log(`summary: ${path.join(outDir, "summary.json")}`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
