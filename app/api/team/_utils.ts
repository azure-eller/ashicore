import { NextResponse } from "next/server";

export async function authApiResponseToNextResponse(
  response: Response,
  successStatus = response.status
) {
  const body = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    return text ? { error: text } : null;
  });

  if (!response.ok) {
    const error =
      body?.error?.message ??
      body?.error ??
      body?.message ??
      "Request failed.";

    return NextResponse.json({ error }, { status: response.status });
  }

  return NextResponse.json(body, { status: successStatus });
}
