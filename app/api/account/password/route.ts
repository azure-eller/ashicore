import { apiHandler } from "@/lib/api/handler";
import { changePasswordSchema } from "@/lib/schemas/account";
import { callAuthApi } from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = changePasswordSchema.parse(body);

  const response = await callAuthApi(request.headers, "changePassword", {
    currentPassword: data.currentPassword,
    newPassword: data.newPassword,
  });

  return authApiResponseToNextResponse(response);
});
