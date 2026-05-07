import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";

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
