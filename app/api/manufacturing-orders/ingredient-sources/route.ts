import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";

export const GET = apiHandler(async () =>
  jsonError(
    "Manufacturing ingredient source allocation has been removed. Pick lots during execution.",
    410
  )
);
