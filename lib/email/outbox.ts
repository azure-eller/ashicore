import path from "node:path";

export const EMAIL_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "email-outbox");
export const EMAIL_OUTBOX_MODE_FLAG = path.join(process.cwd(), ".tmp", "email-outbox-only");
