import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import {
  createPasswordlessOwnerOrg,
  getValidXeroSignupIntent,
  markXeroSignupIntentClaimed,
  persistXeroSignupConnection,
} from "./signup-intents";

const signupIntentQuery = z.object({
  intent: z.string().min(1),
  token: z.string().min(1),
});

function settingsRedirect() {
  return "/settings?xero_signup=connected#integrations";
}

function signupErrorRedirect(reason: string) {
  return `/xero/sign-up/error?reason=${encodeURIComponent(reason)}`;
}

function signupLinkRedirect(intent: string, token: string) {
  const query = `intent=${encodeURIComponent(intent)}&token=${encodeURIComponent(token)}`;
  return `/xero/sign-up/link?${query}`;
}

function signInRedirect(intent: string, token: string) {
  const query = `intent=${encodeURIComponent(intent)}&token=${encodeURIComponent(token)}`;
  const callbackURL = `/api/auth/xero-signup/link?${query}`;
  return `/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`;
}

async function redirectForConnectionResult(
  result: Awaited<ReturnType<typeof persistXeroSignupConnection>>
) {
  if (result.ok) return settingsRedirect();
  return signupErrorRedirect(result.reason);
}

function intentLookup(query: { intent: string; token: string }) {
  return { id: query.intent, token: query.token };
}

export function xeroSignupAuthPlugin() {
  return {
    id: "xero-signup",
    endpoints: {
      completeXeroSignup: createAuthEndpoint(
        "/xero-signup/complete",
        {
          method: "GET",
          query: signupIntentQuery,
          metadata: { openapi: { description: "Complete Xero App Store signup." } },
        },
        async (ctx) => {
          const intent = await getValidXeroSignupIntent(intentLookup(ctx.query));
          if (!intent) {
            throw ctx.redirect(signupErrorRedirect("expired"));
          }

          const existing = await ctx.context.internalAdapter.findUserByEmail(
            intent.email
          );
          if (existing?.user) {
            throw ctx.redirect(signupLinkRedirect(ctx.query.intent, ctx.query.token));
          }

          const createdUser = await ctx.context.internalAdapter.createUser({
            email: intent.email,
            name: intent.name,
            image: null,
            emailVerified: true,
          });
          if (!createdUser) {
            throw ctx.redirect(signupErrorRedirect("user_create_failed"));
          }

          const createdOrg = await createPasswordlessOwnerOrg({
            userId: createdUser.id,
            tenantName: intent.tenantName,
          });
          const connectionResult = await persistXeroSignupConnection(
            createdOrg.id,
            intent
          );
          if (!connectionResult.ok) {
            throw ctx.redirect(await redirectForConnectionResult(connectionResult));
          }

          const session = await ctx.context.internalAdapter.createSession(
            createdUser.id,
            false,
            { activeOrganizationId: createdOrg.id },
            true
          );
          await setSessionCookie(ctx, { user: createdUser, session });
          await markXeroSignupIntentClaimed({
            id: intent.id,
            userId: createdUser.id,
            organizationId: createdOrg.id,
          });

          throw ctx.redirect(settingsRedirect());
        }
      ),
      linkXeroSignup: createAuthEndpoint(
        "/xero-signup/link",
        {
          method: "GET",
          query: signupIntentQuery,
          metadata: { openapi: { description: "Link Xero App Store signup." } },
        },
        async (ctx) => {
          const intent = await getValidXeroSignupIntent(intentLookup(ctx.query));
          if (!intent) {
            throw ctx.redirect(signupErrorRedirect("expired"));
          }

          const session = await getSessionFromCtx(ctx);
          if (!session?.session || !session.user) {
            throw ctx.redirect(signInRedirect(ctx.query.intent, ctx.query.token));
          }

          if (session.user.email.toLowerCase() !== intent.email) {
            throw ctx.redirect(signupErrorRedirect("email_mismatch"));
          }

          const orgId = session.session.activeOrganizationId;
          if (!orgId) {
            throw ctx.redirect(signupErrorRedirect("active_org_required"));
          }

          const connectionResult = await persistXeroSignupConnection(orgId, intent);
          if (!connectionResult.ok) {
            throw ctx.redirect(await redirectForConnectionResult(connectionResult));
          }

          await markXeroSignupIntentClaimed({
            id: intent.id,
            userId: session.user.id,
            organizationId: orgId,
          });

          throw ctx.redirect(settingsRedirect());
        }
      ),
    },
  };
}
