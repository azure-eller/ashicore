import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";

export const GET = apiHandler(async () =>
  jsonError(
    "Manufacturing allocation demand endpoint has been removed. Use demand coverage instead.",
    410
  )
);
