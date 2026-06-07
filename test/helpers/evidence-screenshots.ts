import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Locator, Page } from "@playwright/test";

export const PILOT_EVIDENCE_DIR = path.join(
  os.homedir(),
  "Pictures",
  "erp-pilot-readiness-2026-05-07",
  "web"
);

function sanitizeEvidenceName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function capturePilotEvidence(page: Page, name: string) {
  fs.mkdirSync(PILOT_EVIDENCE_DIR, { recursive: true });
  const filePath = path.join(PILOT_EVIDENCE_DIR, `${sanitizeEvidenceName(name)}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export type CaptureForReviewOptions =
  | {
      mode?: "tiled";
      longEdge?: number;
    }
  | {
      mode: "element";
      locator: Locator;
      longEdge?: number;
    };

const UI_REVIEW_DIR = path.resolve(process.cwd(), ".tmp", "ui-shots");
const DEFAULT_LONG_EDGE = 1568;

function clampLongEdge(value: number | undefined) {
  if (value === undefined) return DEFAULT_LONG_EDGE;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`captureForReview longEdge must be positive, got ${value}.`);
  }
  return Math.min(Math.round(value), 2576);
}

function uiReviewDir(name: string) {
  return path.join(UI_REVIEW_DIR, sanitizeEvidenceName(name) || "shot");
}

async function resizeForReview(buffer: Buffer, longEdge: number) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width <= longEdge && height <= longEdge) {
    return buffer;
  }

  return image
    .resize({
      width: longEdge,
      height: longEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

async function writeReviewShot(
  buffer: Buffer,
  directory: string,
  filename: string,
  longEdge: number
) {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, filename);
  fs.writeFileSync(filePath, await resizeForReview(buffer, longEdge));
  return filePath;
}

export async function captureForReview(
  page: Page,
  name: string,
  options: CaptureForReviewOptions = {}
) {
  const longEdge = clampLongEdge(options.longEdge);
  const directory = uiReviewDir(name);
  fs.rmSync(directory, { recursive: true, force: true });

  if (options.mode === "element") {
    const buffer = await options.locator.screenshot();
    return [await writeReviewShot(buffer, directory, "element.png", longEdge)];
  }

  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("captureForReview requires a page with a fixed viewport size.");
  }

  const scrollState = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
    totalHeight: Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    ),
  }));

  const paths: string[] = [];
  const tileCount = Math.max(1, Math.ceil(scrollState.totalHeight / viewport.height));

  for (let tile = 0; tile < tileCount; tile += 1) {
    const y = tile * viewport.height;
    await page.evaluate((nextY) => window.scrollTo(0, nextY), y);
    await page.waitForTimeout(100);
    const buffer = await page.screenshot();
    const filename = `tile-${String(tile + 1).padStart(2, "0")}.png`;
    paths.push(await writeReviewShot(buffer, directory, filename, longEdge));
  }

  await page.evaluate(
    ({ x, y }) => window.scrollTo(x, y),
    { x: scrollState.x, y: scrollState.y }
  );

  return paths;
}
