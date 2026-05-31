export function getAccountingOAuthCookieDomain() {
  if (process.env.VERCEL_ENV !== "production") return undefined;

  const appUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return undefined;

  try {
    const hostname = new URL(appUrl).hostname;
    return hostname === "ashicore.app" || hostname === "www.ashicore.app"
      ? ".ashicore.app"
      : undefined;
  } catch {
    return undefined;
  }
}

export function getAccountingOAuthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
    domain: getAccountingOAuthCookieDomain(),
  };
}
