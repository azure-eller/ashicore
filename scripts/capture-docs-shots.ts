/**
 * Documentation screenshot pass. Authenticates as the docs-demo org (seeded by
 * scripts/seed-docs-demo.ts) and captures a named manifest of clean, retina PNGs
 * into apps/www for the operator docs.
 *
 *   ERP_ALLOW_UNSAFE_WORKTREE=1 pnpm exec tsx scripts/capture-docs-shots.ts
 *
 * Image-creation rules:
 *  - ILLUSTRATE, don't screen-snip. An Anatomy image is a labelled diagram: the
 *    whole object with a small numbered pin on each region; a numbered legend in
 *    the page (below the image) names them. Pins are injected over the real DOM
 *    sections, so they regenerate and stay aligned.
 *  - Clip to the white object (the card sheet / the grid), never the app chrome
 *    or grey canvas. Hide dev-only overlays. 2× device scale, light theme.
 */
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const ENV_PATH = ".tmp/docs-demo-env.json";
const OUT_DIR = "apps/www/src/assets/docs/purchasing";
const CARD_WIDTH = 1180;
const LIST_WIDTH = 1440;

// Anatomy callouts, in order. The page legend maps these numbers to names.
const ANATOMY_REGIONS = ["order details", "materials", "additional costs", "totals"];

type Env = { baseUrl: string; cookie: string };

function loadEnv(): Env {
  return JSON.parse(readFileSync(ENV_PATH, "utf8")) as Env;
}

async function api(env: Env, path: string): Promise<unknown> {
  const res = await fetch(env.baseUrl + path, {
    headers: { cookie: env.cookie, origin: new URL(env.baseUrl).origin },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function makeContext(browser: Browser, env: Env, width: number): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.addCookies(
    env.cookie.split("; ").map((p) => {
      const i = p.indexOf("=");
      return { name: p.slice(0, i), value: p.slice(i + 1), url: env.baseUrl };
    }),
  );
  return ctx;
}

// The labelled "anatomy" diagram: the whole card with a small numbered pin on
// each region. Clipped to the white sheet (no app background), trimmed to content.
async function shootAnatomy(browser: Browser, env: Env, url: string, out: string) {
  const ctx = await makeContext(browser, env, CARD_WIDTH);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('[data-slot="card-page-sheet"]').first().waitFor({ state: "visible", timeout: 45000 });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(700);
  const clip = await page.evaluate((headings) => {
    const sheet = document.querySelector('[data-slot="card-page-sheet"]');
    if (!sheet) return null;
    const s = sheet.getBoundingClientRect();
    const sections = Array.from(document.querySelectorAll("section"));
    let n = 0;
    for (const heading of headings) {
      const sec = sections.find((el) => {
        const h = el.querySelector("h2, h3");
        return !!h && (h.textContent ?? "").trim().toLowerCase().startsWith(heading);
      });
      if (!sec) continue;
      n += 1;
      const r = sec.getBoundingClientRect();
      const pin = document.createElement("div");
      pin.textContent = String(n);
      pin.style.cssText = `position:fixed;left:${r.left - 13}px;top:${r.top - 9}px;width:28px;height:28px;border-radius:50%;background:#18181b;color:#fff;font:700 16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;z-index:9999;box-shadow:0 1px 4px rgba(0,0,0,.35);`;
      document.body.append(pin);
    }
    const viewport = document.querySelector('[data-slot="card-page-body"] [data-radix-scroll-area-viewport]');
    const content = viewport?.firstElementChild;
    const contentBottom = content ? content.getBoundingClientRect().bottom : s.bottom;
    const bottom = Math.min(contentBottom + 18, s.bottom);
    return { x: s.left, y: s.top, width: s.width, height: bottom - s.top };
  }, ANATOMY_REGIONS);
  if (!clip) throw new Error("card sheet not found");
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, clip });
  await ctx.close();
  console.log(`captured ${out}`);
}

// The orders grid (AG Grid): clip from the grid top (column headers) to the
// bottom of the populated rows, adapting to the seeded row count.
async function shootList(browser: Browser, env: Env, url: string, out: string) {
  const ctx = await makeContext(browser, env, LIST_WIDTH);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".ag-center-cols-container .ag-row").length > 0,
    undefined,
    { timeout: 45000, polling: 500 },
  );
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => {
    const grid = document.querySelector('[data-slot*="grid"]');
    const rows = document.querySelector(".ag-center-cols-container");
    if (!grid || !rows || rows.querySelectorAll(".ag-row").length === 0) return null;
    const g = grid.getBoundingClientRect();
    const r = rows.getBoundingClientRect();
    return { x: g.left, y: g.top, width: g.width, height: r.bottom - g.top };
  });
  if (!clip) throw new Error("grid rows not found for list shot");
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, clip });
  await ctx.close();
  console.log(`captured ${out}`);
}

async function main() {
  const env = loadEnv();
  const origin = new URL(env.baseUrl).origin;

  const orders = (await api(env, "/api/purchase-orders")) as Array<{ id: string; status: string }>;
  const ordered = orders.find((o) => o.status === "not_received");
  if (!ordered) throw new Error("no ordered PO found — run seed-docs-demo first");

  const browser = await chromium.launch();
  await shootAnatomy(browser, env, `${origin}/purchasing/order/${ordered.id}`, `${OUT_DIR}/purchase-order-anatomy.png`);
  await shootList(browser, env, `${origin}/purchasing/orders`, `${OUT_DIR}/purchase-order-list.png`);
  await browser.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
