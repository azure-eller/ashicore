import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { updateProfileSchema } from "@/lib/schemas/account";
import { callAuthApi } from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";

export const PATCH = apiHandler(async (request) => {
  const data = await parseJsonBody(request, updateProfileSchema);

  const response = await callAuthApi(request.headers, "updateUser", data);
  return authApiResponseToNextResponse(response);
});
