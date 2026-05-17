import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        const currentUrl = new URL(window.location.href);
        const requestedNext =
          currentUrl.searchParams.get("next") ??
          `${window.location.pathname}${window.location.search}`;
        const url = new URL("/two-factor", window.location.origin);
        if (requestedNext && requestedNext !== "/sign-in") {
          url.searchParams.set("next", requestedNext);
        }
        window.location.href = url.toString();
      },
    }),
  ],
});
