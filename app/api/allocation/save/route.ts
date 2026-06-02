import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";

export const POST = apiHandler(async () =>
  jsonError("Manual allocation has been removed. Use demand priority to change coverage.", 410)
);
