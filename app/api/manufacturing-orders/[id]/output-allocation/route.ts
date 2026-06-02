import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";

export const GET = apiHandler(async () =>
  jsonError("Manufacturing output allocation has been removed. Use the MTO link on the manufacturing order.", 410)
);

export const PUT = apiHandler(async () =>
  jsonError("Manufacturing output allocation has been removed. Use the MTO link on the manufacturing order.", 410)
);
