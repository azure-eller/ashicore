import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";

export const GET = apiHandler(async () =>
  jsonError("Manual allocation workspace has been removed. Use demand priority to change coverage.", 410)
);
