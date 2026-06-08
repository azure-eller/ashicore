import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
  "STRIPE_CORE_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_LIVE_MODE",
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

function runVercelEnvList(options: Required<Pick<Options, "vercelProjectId" | "vercelTeamId">> & Pick<Options, "vercelProjectName" | "environment">) {
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
    const result = spawnSync(
      "vercel",
      ["env", "ls", options.environment, "--cwd", cwd, "--no-color"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      }
    );

    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout).trim());
    }

    return result.stdout;
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
}

function envNamesFromVercelOutput(output: string) {
  const names = new Set<string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(">") || trimmed.startsWith("name ")) {
      continue;
    }
    const [name] = trimmed.split(/\s+/, 1);
    if (/^[A-Z0-9_]+$/.test(name)) {
      names.add(name);
    }
  }
  return names;
}

function localEnvNames() {
  return new Set(
    Object.entries(process.env)
      .filter(([, value]) => Boolean(value?.trim()))
      .map(([name]) => name)
  );
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
  let envNames: Set<string>;

  if (options.vercelProjectId && options.vercelTeamId) {
    const output = runVercelEnvList({
      vercelProjectId: options.vercelProjectId,
      vercelTeamId: options.vercelTeamId,
      vercelProjectName: options.vercelProjectName,
      environment: options.environment,
    });
    envNames = envNamesFromVercelOutput(output);
  } else {
    envNames = localEnvNames();
  }

  for (const name of REQUIRED_ENV) {
    checks.push(check(`env ${name}`, envNames.has(name)));
  }

  if (envNames.has("STRIPE_LIVE_MODE")) {
    checks.push(
      check(
        "Stripe live mode expected",
        process.env.STRIPE_LIVE_MODE === "1" || options.vercelProjectId !== undefined,
        "verify encrypted value is 1 in Vercel"
      )
    );
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
