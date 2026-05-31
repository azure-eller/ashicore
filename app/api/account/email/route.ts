import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { changeEmailSchema } from "@/lib/schemas/account";
import { callAuthApi } from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";

export const POST = apiHandler(async (request) => {
  const data = await parseJsonBody(request, changeEmailSchema);

  const response = await callAuthApi(request.headers, "changeEmail", {
    newEmail: data.newEmail,
    callbackURL: "/sign-in?notice=email-updated",
  });
  return authApiResponseToNextResponse(response);
});
