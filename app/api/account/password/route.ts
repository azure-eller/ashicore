import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { changePasswordSchema } from "@/lib/schemas/account";
import { callAuthApi } from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";

export const POST = apiHandler(async (request) => {
  const data = await parseJsonBody(request, changePasswordSchema);

  const response = await callAuthApi(request.headers, "changePassword", {
    currentPassword: data.currentPassword,
    newPassword: data.newPassword,
  });

  return authApiResponseToNextResponse(response);
});
