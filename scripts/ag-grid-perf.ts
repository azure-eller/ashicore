import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

type PageKey =
  | "sales-orders"
  | "customers"
  | "purchase-orders"
  | "suppliers"
  | "pricing-schedules"
  | "manufacturing-orders"
  | "manufacturing-resources"
  | "inventory-ledger"
  | "stocktakes"
  | "sales-allocation";

type PageConfig = {
  route: string;
  endpoint?: string;
};

type ScrollResult = {
  label: string;
  url: string;
  rowCount: number | null;
  renderedRowsBefore: number;
  renderedRowsAfter: number;
  durationMs: number;
  frames: number;
  avgFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  droppedFrameBudgetCount: number;
  longTasks: number;
  longTaskTotalMs: number;
  consoleErrors: string[];
};

type ScrollMetrics = {
  durationMs: number;
  frames: number;
  frameDeltas: number[];
  longTasks: number[];
};

const PAGE_CONFIGS: Record<PageKey, PageConfig> = {
  "sales-orders": {
    route: "/sales/orders",
    endpoint: "/api/sales-orders",
  },
  customers: {
    route: "/sales/customers",
    endpoint: "/api/customers",
  },
  "purchase-orders": {
    route: "/purchasing/orders",
    endpoint: "/api/purchase-orders",
  },
  suppliers: {
    route: "/purchasing/suppliers",
    endpoint: "/api/suppliers",
  },
  "pricing-schedules": {
    route: "/sales/pricing",
    endpoint: "/api/pricing-schedules",
  },
  "manufacturing-orders": {
    route: "/manufacturing/orders",
    endpoint: "/api/manufacturing-orders",
  },
  "manufacturing-resources": {
    route: "/manufacturing/resources",
    endpoint: "/api/manufacturing-resources",
  },
  "inventory-ledger": {
    route: "/inventory/ledger",
    endpoint: "/api/inventory-ledger",
  },
  stocktakes: {
    route: "/inventory/stocktakes",
    endpoint: "/api/stocktakes",
  },
  "sales-allocation": {
    route: "/sales/allocation",
    endpoint: "/api/allocation/workspace",
  },
};

const DEFAULT_PAGES: PageKey[] = [
  "sales-orders",
  "customers",
  "purchase-orders",
  "suppliers",
  "pricing-schedules",
  "manufacturing-orders",
  "manufacturing-resources",
  "inventory-ledger",
  "stocktakes",
];

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function getArg(name: string) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function getFlag(name: string) {
  return process.argv.includes(name);
}

function getNumberArg(name: string, fallback: number) {
  const value =
    getArg(name) ??
    process.env[name.replace(/^--/, "").replace(/-/g, "_").toUpperCase()];
  if (value == null || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return parsed;
}

function parsePages(value: string | undefined): PageKey[] {
  if (!value) return DEFAULT_PAGES;

  return value.split(",").map((page) => {
    const key = page.trim();
    if (!(key in PAGE_CONFIGS)) {
      throw new Error(
        `Unknown page "${key}". Valid pages: ${Object.keys(PAGE_CONFIGS).join(", ")}`
      );
    }
    return key as PageKey;
  });
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? 0;
}

function finiteNumbers(values: number[]) {
  return values.filter((value) => Number.isFinite(value));
}

async function getApiRowCount(page: Page, endpoint: string | undefined) {
  if (!endpoint) return null;

  return page.evaluate(async (input) => {
    const response = await fetch(input);
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data)) return data.length;
    if (Array.isArray(data?.rows)) return data.rows.length;
    if (Array.isArray(data?.items)) return data.items.length;
    if (Array.isArray(data?.orders)) return data.orders.length;
    return null;
  }, endpoint);
}

async function measurePage(
  page: Page,
  baseUrl: string,
  key: PageKey,
  runIndex: number
) {
  const config = PAGE_CONFIGS[key];
  const consoleErrors: string[] = [];
  const consoleListener = (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  };

  page.on("console", consoleListener);

  try {
    await page.goto(`${baseUrl}${config.route}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-slot='erp-data-grid'] .ag-body-viewport", {
      timeout: 30_000,
    });
    await page.waitForTimeout(750);

    const rowCount = await getApiRowCount(page, config.endpoint);
    const renderedRowsBefore = await page
      .locator("[data-slot='erp-data-grid'] .ag-center-cols-container .ag-row")
      .count();

    const metrics = (await page.evaluate(`(async () => {
      const viewport =
        document.querySelector(
          "[data-slot='erp-data-grid'] .ag-body-vertical-scroll-viewport"
        ) ??
        document.querySelector(
          "[data-slot='erp-data-grid'] .ag-body-viewport"
        );
      if (!viewport) throw new Error("AG Grid viewport not found");

      viewport.scrollTop = 0;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => window.setTimeout(resolve, 250));

      const longTasks = [];
      let observer = null;
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push(entry.duration);
          }
        });
        observer.observe({ type: "longtask" });
      } catch {
        observer?.disconnect();
      }

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const frameDeltas = [];
      const targetDurationMs = 2600;
      const start = performance.now();
      let previous = start;
      let frames = 0;

      await new Promise((resolve) => {
        const step = (now) => {
          const elapsed = now - start;
          frameDeltas.push(now - previous);
          previous = now;
          frames += 1;
          const progress = Math.min(1, elapsed / targetDurationMs);
          viewport.scrollTop = maxScrollTop * progress;
          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(step);
      });

      observer?.disconnect();
      return {
        durationMs: performance.now() - start,
        frames,
        frameDeltas,
        longTasks,
      };
    })()`)) as ScrollMetrics;

    const renderedRowsAfter = await page
      .locator("[data-slot='erp-data-grid'] .ag-center-cols-container .ag-row")
      .count();
    const frameDeltas = finiteNumbers(metrics.frameDeltas.slice(1));
    if (frameDeltas.length === 0) {
      throw new Error(`${key}#${runIndex + 1} did not record any frame deltas.`);
    }
    const longTasks = finiteNumbers(metrics.longTasks);

    return {
      label: `${key}#${runIndex + 1}`,
      url: `${baseUrl}${config.route}`,
      rowCount,
      renderedRowsBefore,
      renderedRowsAfter,
      durationMs: metrics.durationMs,
      frames: metrics.frames,
      avgFrameMs:
        frameDeltas.reduce((sum, value) => sum + value, 0) / frameDeltas.length,
      p50FrameMs: percentile(frameDeltas, 0.5),
      p95FrameMs: percentile(frameDeltas, 0.95),
      maxFrameMs: Math.max(...frameDeltas),
      droppedFrameBudgetCount: frameDeltas.filter((value) => value > 16.7).length,
      longTasks: longTasks.length,
      longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
      consoleErrors,
    } satisfies ScrollResult;
  } finally {
    page.off("console", consoleListener);
  }
}

function summarize(results: ScrollResult[]) {
  return Object.fromEntries(
    Object.keys(PAGE_CONFIGS).flatMap((key) => {
      const rows = results.filter((result) => result.label.startsWith(`${key}#`));
      if (rows.length === 0) return [];
      const sorted = (field: keyof ScrollResult) =>
        rows
          .map((row) => row[field])
          .filter((value): value is number =>
            typeof value === "number" && Number.isFinite(value)
          )
          .sort((left, right) => left - right);
      const median = (field: keyof ScrollResult) => {
        const values = sorted(field);
        return values[Math.floor(values.length / 2)] ?? 0;
      };
      const mean = (field: keyof ScrollResult) => {
        const values = sorted(field);
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      };

      return [
        [
          key,
          {
            runs: rows.length,
            rowCount: rows[0]?.rowCount,
            rendered: `${rows[0]?.renderedRowsBefore}->${rows[0]?.renderedRowsAfter}`,
            medianP95FrameMs: Number(median("p95FrameMs").toFixed(1)),
            medianMaxFrameMs: Number(median("maxFrameMs").toFixed(1)),
            meanLongTaskMs: Number(mean("longTaskTotalMs").toFixed(1)),
            medianFrames: median("frames"),
            consoleErrors: [...new Set(rows.flatMap((row) => row.consoleErrors))],
          },
        ],
      ];
    })
  );
}

async function main() {
  const worktree = process.cwd();
  const session = readJsonIfExists<{ baseUrl: string }>(
    path.join(worktree, ".tmp/agent-session.json")
  );
  const reviewEnv = readJsonIfExists<{
    TEST_BASE_URL?: string;
    TEST_STORAGE_STATE?: string;
  }>(path.join(worktree, "test/.review-env.json"));
  const storageState =
    getArg("--storage-state") ??
    process.env.TEST_STORAGE_STATE ??
    reviewEnv?.TEST_STORAGE_STATE ??
    path.join(worktree, "test/.auth/storage-state.json");
  const baseUrl =
    getArg("--base-url") ??
    process.env.TEST_BASE_URL ??
    reviewEnv?.TEST_BASE_URL ??
    session?.baseUrl;

  if (!baseUrl) {
    throw new Error("No base URL found. Run pnpm boot, pnpm sandbox, or pass --base-url=...");
  }

  const pages = parsePages(getArg("--pages") ?? process.env.PAGES);
  const runs = getNumberArg("--runs", 5);
  const maxMedianP95FrameMs = getNumberArg("--max-median-p95-frame-ms", 20);
  const maxMeanLongTaskMs = getNumberArg("--max-mean-long-task-ms", 100);
  const output =
    getArg("--output") ??
    process.env.OUTPUT ??
    path.join(worktree, ".tmp/ag-grid-perf.json");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const results: ScrollResult[] = [];

  for (const key of pages) {
    for (let index = 0; index < runs; index += 1) {
      results.push(await measurePage(page, baseUrl, key, index));
    }
  }

  await browser.close();

  const summary = summarize(results);
  const failures = Object.entries(summary).flatMap(([key, value]) => {
    const pageSummary = value as {
      medianP95FrameMs: number;
      meanLongTaskMs: number;
      consoleErrors: string[];
    };
    const nextFailures: string[] = [];

    if (pageSummary.medianP95FrameMs > maxMedianP95FrameMs) {
      nextFailures.push(
        `${key} median p95 ${pageSummary.medianP95FrameMs}ms exceeds ${maxMedianP95FrameMs}ms`
      );
    }
    if (pageSummary.meanLongTaskMs > maxMeanLongTaskMs) {
      nextFailures.push(
        `${key} mean long-task ${pageSummary.meanLongTaskMs}ms exceeds ${maxMeanLongTaskMs}ms`
      );
    }
    if (getFlag("--fail-on-console-error") && pageSummary.consoleErrors.length > 0) {
      nextFailures.push(`${key} emitted ${pageSummary.consoleErrors.length} console error(s)`);
    }

    return nextFailures;
  });
  const payload = {
    baseUrl,
    pages,
    runs,
    thresholds: {
      maxMedianP95FrameMs,
      maxMeanLongTaskMs,
      failOnConsoleError: getFlag("--fail-on-console-error"),
    },
    generatedAt: new Date().toISOString(),
    results,
    summary,
    failures,
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);

  if (getFlag("--summary")) {
    console.log(JSON.stringify(payload.summary, null, 2));
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }

  if (failures.length > 0) {
    console.error(`AG Grid performance thresholds failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
