import path from "node:path";

export const MARKETING_TEST_MODE_FLAG = path.join(
  process.cwd(),
  ".tmp",
  "marketing-test-mode",
);

export const MARKETING_GMAIL_OUTBOX_DIR = path.join(
  process.cwd(),
  ".tmp",
  "marketing-gmail-outbox",
);

export const MARKETING_GMAIL_INBOX_DIR = path.join(
  process.cwd(),
  ".tmp",
  "marketing-gmail-inbox",
);
