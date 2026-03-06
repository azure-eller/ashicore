import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";

export const getAuthedContext = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  if (!session.session.activeOrganizationId) {
    redirect("/org-setup");
  }

  return {
    userId: session.user.id,
    orgId: session.session.activeOrganizationId,
  };
});

export async function withAuthedOrgContext<T>(
  callback: (tx: Tx) => Promise<T>
): Promise<T> {
  const { orgId } = await getAuthedContext();
  return withOrgContext(orgId, callback);
}
