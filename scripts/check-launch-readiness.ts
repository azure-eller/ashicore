import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Stripe from "stripe";
import { PRO_MONTHLY_USD, PRO_PLAN_LOOKUP_KEY } from "../lib/billing/types";

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

type Options = {
  vercelProjectId?: string;
  vercelTeamId?: string;
  vercelProjectName?: string;
  environment: "production";
  marketingUrl?: string;
};

const REQUIRED_ENV = [
  "DATABASE_URL",
  "DATABASE_URL_APP",
  "DATABASE_URL_UNPOOLED",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_ALLOWED_HOSTS",
  "NEXT_PUBLIC_APP_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "ASHICORE_ALERT_EMAILS",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_LIVE_MODE",
  "STRIPE_CATALOG_READY",
] as const;

function parseArgs(): Options {
  const options: Options = { environment: "production" };
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) continue;

    const [flag, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? next;
    if (!inlineValue) index += 1;

    if (flag === "--vercel-project-id") options.vercelProjectId = value;
    if (flag === "--vercel-team-id") options.vercelTeamId = value;
    if (flag === "--vercel-project-name") options.vercelProjectName = value;
    if (flag === "--marketing-url") options.marketingUrl = value;
  }

  return options;
}

function check(name: string, ok: boolean, detail?: string): Check {
  return { name, ok, detail };
}

function withLinkedVercelProject<T>(
  options: Required<Pick<Options, "vercelProjectId" | "vercelTeamId">> &
    Pick<Options, "vercelProjectName">,
  callback: (cwd: string) => T
) {
  const cwd = mkdtempSync(join(tmpdir(), "ashicore-launch-check-"));
  try {
    const vercelDir = join(cwd, ".vercel");
    mkdirSync(vercelDir);
    const projectName = options.vercelProjectName ?? "erp";
    writeFileSync(
      join(vercelDir, "project.json"),
      JSON.stringify(
        {
          projectId: options.vercelProjectId,
          orgId: options.vercelTeamId,
          projectName,
        },
        null,
        2
      )
    );
  } catch (error) {
    rmSync(cwd, { force: true, recursive: true });
    throw error;
  }

  try {
    return callback(cwd);
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
}

function runVercelEnvPull(
  options: Required<Pick<Options, "vercelProjectId" | "vercelTeamId">> &
    Pick<Options, "vercelProjectName" | "environment">
) {
  return withLinkedVercelProject(options, (cwd) => {
    const envPath = join(cwd, ".env.production.local");
    const result = spawnSync(
      "vercel",
      [
        "env",
        "pull",
        envPath,
        `--environment=${options.environment}`,
        "--yes",
        "--cwd",
        cwd,
        "--no-color",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      }
    );

    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout).trim());
    }

    return parseDotEnv(envPath);
  });
}

function parseDotEnv(path: string) {
  const env = new Map<string, string>();
  const text = readFileSync(path, "utf8");

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equals = trimmed.indexOf("=");
    if (equals < 1) {
      continue;
    }
    const name = trimmed.slice(0, equals);
    let value = trimmed.slice(equals + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (/^[A-Z0-9_]+$/.test(name) && value.trim()) {
      env.set(name, value);
    }
  }
  return env;
}

function localEnvValues() {
  return new Map(
    Object.entries(process.env)
      .filter(([, value]) => Boolean(value?.trim()))
      .map(([name, value]) => [name, value?.trim() ?? ""])
  );
}

// STRIPE_CATALOG_READY is a manually set flag. On its own it only proves someone
// typed "1"; it does not prove the catalog was actually created in the Stripe
// account this deployment authenticates with. When a deploy claims readiness,
// confirm the sellable price really exists so "Start Pro" can't 503 in production.
async function checkStripeCatalogPrice(secretKey: string): Promise<Check> {
  const name = `Stripe ${PRO_PLAN_LOOKUP_KEY} price is live and canonical`;
  try {
    const stripe = new Stripe(secretKey);
    const prices = await stripe.prices.list({
      lookup_keys: [PRO_PLAN_LOOKUP_KEY],
      active: true,
      limit: 100,
    });
    const canonical = prices.data.filter(
      (price) =>
        price.livemode &&
        price.lookup_key === PRO_PLAN_LOOKUP_KEY &&
        price.currency === "usd" &&
        price.unit_amount === PRO_MONTHLY_USD * 100 &&
        price.billing_scheme === "per_unit" &&
        price.recurring?.interval === "month" &&
        price.recurring.interval_count === 1
    );
    const ready = secretKey.startsWith("sk_live_") && prices.data.length === 1 && canonical.length === 1;
    return check(
      name,
      ready,
      ready
        ? `one active USD $${PRO_MONTHLY_USD}/month price in live mode`
        : `expected exactly one active live USD $${PRO_MONTHLY_USD}/month price; found ${prices.data.length} active and ${canonical.length} canonical — run scripts/stripe-create-catalog.ts against the live Stripe account`
    );
  } catch (error) {
    return check(name, false, error instanceof Error ? error.message : String(error));
  }
}

async function checkMarketingSite(url: string): Promise<Check[]> {
  const response = await fetch(url);
  if (!response.ok) {
    return [check("marketing site reachable", false, `${response.status}`)];
  }

  const html = await response.text();
  return [
    check("marketing site reachable", true, url),
    check("Vercel Analytics component rendered", html.includes("vercel-analytics")),
    check("custom acquisition event attributes rendered", html.includes("data-analytics-event")),
  ];
}

function printChecks(checks: Check[]) {
  for (const item of checks) {
    const status = item.ok ? "PASS" : "FAIL";
    console.log(`${status} ${item.name}${item.detail ? ` (${item.detail})` : ""}`);
  }
}

async function main() {
  const options = parseArgs();
  const checks: Check[] = [];
  let envValues: Map<string, string>;

  if (options.vercelProjectId && options.vercelTeamId) {
    envValues = runVercelEnvPull({
      vercelProjectId: options.vercelProjectId,
      vercelTeamId: options.vercelTeamId,
      vercelProjectName: options.vercelProjectName,
      environment: options.environment,
    });
  } else {
    envValues = localEnvValues();
  }

  for (const name of REQUIRED_ENV) {
    checks.push(check(`env ${name}`, envValues.has(name)));
  }

  if (envValues.has("STRIPE_LIVE_MODE")) {
    checks.push(
      check(
        "Stripe live mode expected",
        envValues.get("STRIPE_LIVE_MODE") === "1",
        "STRIPE_LIVE_MODE must be exactly 1"
      )
    );
  }

  if (envValues.has("STRIPE_CATALOG_READY")) {
    checks.push(
      check(
        "Stripe catalog marked ready",
        envValues.get("STRIPE_CATALOG_READY") === "1",
        "STRIPE_CATALOG_READY must be exactly 1 after catalog creation"
      )
    );
  }

  // When the deploy claims the catalog is ready, verify it against Stripe itself
  // rather than trusting the flag. Skipped when no secret key is available.
  const stripeSecretKey = envValues.get("STRIPE_SECRET_KEY");
  if (envValues.get("STRIPE_CATALOG_READY") === "1" && stripeSecretKey) {
    checks.push(await checkStripeCatalogPrice(stripeSecretKey));
  }

  if (options.marketingUrl) {
    checks.push(...(await checkMarketingSite(options.marketingUrl)));
  }

  printChecks(checks);

  if (checks.some((item) => !item.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
