import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wwwRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(wwwRoot, "../..");
const configPath = path.join(wwwRoot, "vercel.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const rewriteSources = new Set((config.rewrites ?? []).map((rule) => rule.source));
const redirectSources = new Set((config.redirects ?? []).map((rule) => rule.source));
const allSources = new Set([...rewriteSources, ...redirectSources]);

const expectedExact = new Set([
  "/sign-in",
  "/sign-up",
  "/accept-invitation",
  "/forgot-password",
  "/reset-password",
  "/two-factor",
  "/mfa-setup",
  "/org-setup",
  "/onboarding",
  "/no-access",
  "/android",
  "/.well-known",
]);

const expectedNested = new Set([
  "/xero/sign-up",
  "/sales",
  "/inventory",
  "/manufacturing",
  "/purchasing",
  "/settings",
  "/downloads",
  "/api",
  "/.well-known",
  "/monitoring",
]);

const publicAstroRoutes = new Set([
  "/",
  "/privacy",
  "/terms",
  "/support",
  "/pricing",
  "/security",
  "/resources",
  "/subprocessors",
  "/cookies",
  "/robots.txt",
  "/sitemap.xml",
  "/404",
]);

const intentionallyNotRewritten = new Set([
  "/dev",
]);

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(filePath));
      continue;
    }
    if (entry.name === "page.tsx" || entry.name === "route.ts") {
      files.push(filePath);
    }
  }

  return files;
}

function routeFromFile(filePath, routeGroup) {
  const relative = path.relative(path.join(repoRoot, "app", routeGroup), filePath);
  const route = relative
    .replace(/\/page\.tsx$/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\/\([^)]*\)/g, "")
    .replace(/\/?\[[^/]+\]/g, "");

  if (!route || route === "page.tsx") return "/";
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "");
}

function topLevel(route) {
  if (route === "/") return "/";
  return `/${route.split("/").filter(Boolean)[0]}`;
}

function assertSource(source, label, failures) {
  if (!rewriteSources.has(source)) {
    failures.push(`Missing rewrite for ${label}: ${source}`);
  }
}

const failures = [];

for (const source of allSources) {
  if (source === "/:path*" || source === "/(.*)" || source === "/*") {
    failures.push(`Catch-all route is forbidden: ${source}`);
  }

  if (source.startsWith("/_next")) {
    failures.push(`/_next rewrites are forbidden; use ERP assetPrefix instead: ${source}`);
  }
}

for (const exact of expectedExact) {
  assertSource(exact, "exact ERP route", failures);
}

for (const prefix of expectedNested) {
  assertSource(`${prefix}/:path*`, "nested ERP route", failures);
}

for (const prefix of ["/sales", "/inventory", "/manufacturing", "/purchasing", "/settings"]) {
  assertSource(prefix, "dashboard root", failures);
  assertSource(`${prefix}/:path*`, "dashboard nested path", failures);
}

const dashboardRoot = path.join(repoRoot, "app", "(dashboard)");
const authRoot = path.join(repoRoot, "app", "(auth)");

if (statSync(dashboardRoot, { throwIfNoEntry: false })?.isDirectory()) {
  for (const filePath of walk(dashboardRoot)) {
    const route = routeFromFile(filePath, "(dashboard)");
    const owner = topLevel(route);
    if (route === "/") continue;
    if (intentionallyNotRewritten.has(owner)) continue;
    if (!expectedExact.has(owner) && !expectedNested.has(owner)) {
      failures.push(`Dashboard route ${route} has no ownership entry for ${owner}`);
    }
  }
}

if (statSync(authRoot, { throwIfNoEntry: false })?.isDirectory()) {
  for (const filePath of walk(authRoot)) {
    const route = routeFromFile(filePath, "(auth)");
    const owner = route.startsWith("/xero/sign-up") ? "/xero/sign-up" : topLevel(route);
    if (!expectedExact.has(owner) && !expectedNested.has(owner)) {
      failures.push(`Auth route ${route} has no ownership entry for ${owner}`);
    }
  }
}

for (const route of ["/android", "/api", "/.well-known"]) {
  const source = route === "/api" ? "/api/:path*" : route;
  if (!rewriteSources.has(source)) {
    failures.push(`Required ERP route missing from rewrites: ${source}`);
  }
}

for (const route of publicAstroRoutes) {
  if (rewriteSources.has(route)) {
    failures.push(`Public Astro route is incorrectly rewritten to ERP: ${route}`);
  }
}

if (!redirectSources.has("/login")) {
  failures.push("Missing /login -> /sign-in redirect.");
}

if (failures.length) {
  console.error("Route ownership verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Route ownership verified.");
