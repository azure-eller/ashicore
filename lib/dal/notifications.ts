import "server-only";

import { and, asc, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import {
  getAuthedApiMemberContext,
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import {
  manufacturingResources,
  notificationPreferences,
  notificationResourceExclusions,
  pushDevices,
} from "@/lib/db/schema";
import { withUserContext } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import {
  NOTIFICATION_TYPES,
  SUBSCRIBABLE_EVENT_TYPES,
  type SubscribableEventType,
} from "@/lib/reports/constants";

export async function getNotificationPreferencesForRequest(
  requestHeaders: HeadersInit
) {
  await getAuthedApiMemberContext(requestHeaders);

  return withAuthedOrgContext(async (tx, _orgId, userId) => {
    const rows = await tx
      .select({
        eventType: notificationPreferences.eventType,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    const resources = await tx
      .select({
        id: manufacturingResources.id,
        name: manufacturingResources.name,
        resourceType: manufacturingResources.resourceType,
      })
      .from(manufacturingResources)
      .where(isNull(manufacturingResources.deletedAt))
      .orderBy(asc(manufacturingResources.name));
    const exclusions = await tx
      .select({ resourceId: notificationResourceExclusions.resourceId })
      .from(notificationResourceExclusions)
      .where(
        and(
          eq(notificationResourceExclusions.userId, userId),
          eq(
            notificationResourceExclusions.eventType,
            NOTIFICATION_TYPES.MANUFACTURING_ORDER_CREATED
          )
        )
      );

    const stored = new Map(rows.map((row) => [row.eventType, row.enabled]));
    const excludedResourceIds = new Set(exclusions.map((row) => row.resourceId));
    return {
      preferences: SUBSCRIBABLE_EVENT_TYPES.map((eventType) => ({
        eventType,
        enabled: stored.get(eventType) ?? false,
        ...(eventType === NOTIFICATION_TYPES.MANUFACTURING_ORDER_CREATED
          ? {
              resourceFilter: {
                resources: resources.map((resource) => ({
                  ...resource,
                  excluded: excludedResourceIds.has(resource.id),
                })),
              },
            }
          : {}),
      })),
    };
  });
}

export async function upsertNotificationPreferenceForRequest(
  requestHeaders: HeadersInit,
  input: { eventType: SubscribableEventType; enabled: boolean }
) {
  await getAuthedApiMemberContext(requestHeaders);

  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await tx
      .insert(notificationPreferences)
      .values({
        organizationId: orgId,
        userId,
        eventType: input.eventType,
        enabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.organizationId,
          notificationPreferences.userId,
          notificationPreferences.eventType,
        ],
        set: { enabled: input.enabled, updatedAt: new Date() },
      });

    return { eventType: input.eventType, enabled: input.enabled };
  });
}

export async function setNotificationResourceExclusionForRequest(
  requestHeaders: HeadersInit,
  input: {
    eventType: typeof NOTIFICATION_TYPES.MANUFACTURING_ORDER_CREATED;
    resourceId: string;
    excluded: boolean;
  }
) {
  await getAuthedApiMemberContext(requestHeaders);

  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [resource] = await tx
      .select({ id: manufacturingResources.id })
      .from(manufacturingResources)
      .where(
        and(
          eq(manufacturingResources.id, input.resourceId),
          isNull(manufacturingResources.deletedAt)
        )
      )
      .limit(1);

    if (!resource) {
      throw new DomainError("Manufacturing resource not found", 404);
    }

    if (input.excluded) {
      await tx
        .insert(notificationResourceExclusions)
        .values({
          organizationId: orgId,
          userId,
          eventType: input.eventType,
          resourceId: input.resourceId,
        })
        .onConflictDoUpdate({
          target: [
            notificationResourceExclusions.organizationId,
            notificationResourceExclusions.userId,
            notificationResourceExclusions.eventType,
            notificationResourceExclusions.resourceId,
          ],
          set: { updatedAt: new Date() },
        });
    } else {
      await tx
        .delete(notificationResourceExclusions)
        .where(
          and(
            eq(notificationResourceExclusions.organizationId, orgId),
            eq(notificationResourceExclusions.userId, userId),
            eq(notificationResourceExclusions.eventType, input.eventType),
            eq(notificationResourceExclusions.resourceId, input.resourceId)
          )
        );
    }

    return {
      eventType: input.eventType,
      resourceId: input.resourceId,
      excluded: input.excluded,
    };
  });
}

// push_devices is user-scoped, so set app.current_user_id for its RLS policy.

const MAX_PUSH_DEVICES_PER_USER = 10;

export async function registerPushDeviceForRequest(
  requestHeaders: HeadersInit,
  input: { token: string; platform: "android" }
) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  // Ownership moves with the login on shared devices, so the upsert reassigns userId.
  await withUserContext(context.userId, async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_fcm_token', ${input.token}, true)`);

    const [registered] = await tx
      .insert(pushDevices)
      .values({
        userId: context.userId,
        fcmToken: input.token,
        platform: input.platform,
      })
      .onConflictDoUpdate({
        target: pushDevices.fcmToken,
        set: {
          userId: context.userId,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ id: pushDevices.id });
    if (!registered) {
      throw new Error("Push device registration did not return a row.");
    }

    // Evict stale tokens: app reinstalls mint new tokens, so cap rows per user.
    const keep = tx
      .select({ id: pushDevices.id })
      .from(pushDevices)
      .where(
        and(eq(pushDevices.userId, context.userId), ne(pushDevices.id, registered.id))
      )
      .orderBy(desc(pushDevices.lastSeenAt), desc(pushDevices.id))
      .limit(MAX_PUSH_DEVICES_PER_USER - 1);
    await tx
      .delete(pushDevices)
      .where(
        and(
          eq(pushDevices.userId, context.userId),
          ne(pushDevices.id, registered.id),
          notInArray(pushDevices.id, keep)
        )
      );
  });

  return { ok: true };
}

export async function removePushDeviceForRequest(
  requestHeaders: HeadersInit,
  token: string
) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  await withUserContext(context.userId, (tx) =>
    tx
      .delete(pushDevices)
      .where(
        and(eq(pushDevices.fcmToken, token), eq(pushDevices.userId, context.userId))
      )
  );

  return { ok: true };
}
