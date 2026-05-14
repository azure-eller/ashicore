import { and, eq } from "drizzle-orm";
import { userViewPreferences } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";

export async function getUserViewPreferencePayload(viewKey: string) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [preference] = await tx
      .select({ payload: userViewPreferences.payload })
      .from(userViewPreferences)
      .where(
        and(
          eq(userViewPreferences.organizationId, orgId),
          eq(userViewPreferences.userId, userId),
          eq(userViewPreferences.viewKey, viewKey)
        )
      )
      .limit(1);

    return preference?.payload ?? {};
  });
}

export async function saveUserViewPreferencePayload(
  viewKey: string,
  payload: Record<string, unknown>
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [preference] = await tx
      .insert(userViewPreferences)
      .values({
        organizationId: orgId,
        userId,
        viewKey,
        payload,
      })
      .onConflictDoUpdate({
        target: [
          userViewPreferences.userId,
          userViewPreferences.organizationId,
          userViewPreferences.viewKey,
        ],
        set: {
          payload,
          updatedAt: new Date(),
        },
      })
      .returning({ payload: userViewPreferences.payload });

    return preference.payload;
  });
}
