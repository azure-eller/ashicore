import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";

export const GET = apiHandler(async () =>
  jsonError("Sales order allocator preferences have been removed.", 410)
);

export const PUT = apiHandler(async () =>
  jsonError("Sales order allocator preferences have been removed.", 410)
);
