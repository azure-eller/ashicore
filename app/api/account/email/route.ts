import { apiHandler } from "@/lib/api/handler";
import { changeEmailSchema } from "@/lib/schemas/account";
import { callAuthApi } from "@/app/(dashboard)/settings/queries";
import { authApiResponseToNextResponse } from "@/app/api/_utils/auth-api-response";

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = changeEmailSchema.parse(body);

  const response = await callAuthApi(request.headers, "changeEmail", {
    newEmail: data.newEmail,
    callbackURL: "/sign-in?notice=email-updated",
  });
  return authApiResponseToNextResponse(response);
});
