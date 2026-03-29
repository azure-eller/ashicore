import { apiHandler } from "@/lib/api/handler";
import { updateProfileSchema } from "@/lib/schemas/account";
import { callAuthApi } from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";

export const PATCH = apiHandler(async (request) => {
  const body = await request.json();
  const data = updateProfileSchema.parse(body);

  const response = await callAuthApi(request.headers, "updateUser", data);
  return authApiResponseToNextResponse(response);
});
