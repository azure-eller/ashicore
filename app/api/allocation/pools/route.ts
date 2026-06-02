import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";

export const GET = apiHandler(async () =>
  jsonError("Manual allocation pools have been removed. Use demand coverage instead.", 410)
);
