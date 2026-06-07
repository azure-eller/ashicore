import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import {
  assertModuleReadAccess,
  getAuthedApiMemberContext,
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import { notifications } from "@/lib/db/schema";
import { notificationKindFor } from "@/lib/reports/constants";

export async function getNotificationsForRequest(requestHeaders: HeadersInit) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        deliveryStatus: notifications.deliveryStatus,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, context.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(100);

    return {
      unreadCount: rows.filter((row) => row.readAt == null).length,
      notifications: rows.map((row) => ({
        ...row,
        // Server-owned presentational taxonomy for the mobile inbox icon tile.
        kind: notificationKindFor(row.type, row.entityType),
      })),
    };
  });
}

export async function markNotificationReadForRequest(
  requestHeaders: HeadersInit,
  notificationId: string
) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .update(notifications)
      .set({
        readAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, context.userId),
          isNull(notifications.readAt)
        )
      )
      .returning({ id: notifications.id });

    return row ?? null;
  });
}

export async function requireReportReadAccessForRequest(requestHeaders: HeadersInit) {
  return assertModuleReadAccess("manufacturing", requestHeaders);
}
