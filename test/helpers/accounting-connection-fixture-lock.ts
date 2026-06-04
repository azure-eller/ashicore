import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LOCK_DIR = path.join(os.tmpdir(), "ashicore-accounting-connection-fixture.lock");
const STALE_LOCK_MS = 120_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withAccountingConnectionFixtureLock<T>(fn: () => Promise<T>) {
  while (true) {
    try {
      await fs.mkdir(LOCK_DIR);
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") {
        throw error;
      }

      const stat = await fs.stat(LOCK_DIR).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
        await fs.rm(LOCK_DIR, { recursive: true, force: true });
      }
      await sleep(50);
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(LOCK_DIR, { recursive: true, force: true });
  }
}
