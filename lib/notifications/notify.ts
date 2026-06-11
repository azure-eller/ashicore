import "server-only";

import { and, eq } from "drizzle-orm";
import {
  notificationPreferences,
  notifications,
  pushDevices,
} from "@/lib/db/schema";
import { withOrgContext, withUserContext } from "@/lib/db/with-org-context";
import { sendPush } from "@/lib/notifications/fcm";
import { captureAppError } from "@/lib/observability/sentry";
import type {
  NotificationEntityType,
  NotificationType,
} from "@/lib/reports/constants";

export type NotificationEvent = {
  type: NotificationType;
  entityType: NotificationEntityType;
  entityId: string;
  title: string;
  body: string;
};

/**
 * Fan an event out to every subscribed user in the org: insert one
 * notifications row per subscriber, then best-effort FCM push to each of their
 * devices. Call AFTER the business transaction has committed — a notification
 * must never reference rolled-back work, and a push failure must never fail
 * the mutation. Never throws.
 */
export async function notify(orgId: string, event: NotificationEvent): Promise<void> {
  try {
    const inserted = await withOrgContext(orgId, async (tx) => {
      const subscribers = await tx
        .select({ userId: notificationPreferences.userId })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.organizationId, orgId),
            eq(notificationPreferences.eventType, event.type),
            eq(notificationPreferences.enabled, true)
          )
        );
      if (subscribers.length === 0) return [];

      return tx
        .insert(notifications)
        .values(
          subscribers.map((subscriber) => ({
            organizationId: orgId,
            userId: subscriber.userId,
            type: event.type,
            title: event.title,
            body: event.body,
            entityType: event.entityType,
            entityId: event.entityId,
          }))
        )
        .returning({ id: notifications.id, userId: notifications.userId });
    });
    if (inserted.length === 0) return;

    // Per-row isolation: one subscriber's failure must not abort the others.
    for (const row of inserted) {
      try {
        const userDevices = await withUserContext(row.userId, (tx) =>
          tx
            .select({ userId: pushDevices.userId, fcmToken: pushDevices.fcmToken })
            .from(pushDevices)
            .where(eq(pushDevices.userId, row.userId))
        );
        if (userDevices.length === 0) continue;

        let allOk = true;
        for (const device of userDevices) {
          const result = await sendPush({
            token: device.fcmToken,
            data: {
              notificationId: row.id,
              type: event.type,
              entityType: event.entityType,
              entityId: event.entityId,
              organizationId: orgId,
              title: event.title,
              body: event.body,
            },
          });
          if (result.delivery === "failed") {
            allOk = false;
            console.error("[notifications] push send failed", {
              notificationId: row.id,
              orgId,
              userId: row.userId,
              deadToken: result.deadToken,
              error: result.error,
            });
            if (result.deadToken) {
              await withUserContext(row.userId, (tx) =>
                tx
                  .delete(pushDevices)
                  .where(
                    and(
                      eq(pushDevices.fcmToken, device.fcmToken),
                      eq(pushDevices.userId, row.userId)
                    )
                  )
              );
            }
          }
        }

        await withOrgContext(orgId, (tx) =>
          tx
            .update(notifications)
            .set({ deliveryStatus: allOk ? "delivered" : "failed" })
            .where(eq(notifications.id, row.id))
        );
      } catch (error) {
        console.error(
          "[notifications] fan-out row failed",
          { notificationId: row.id, orgId, userId: row.userId },
          error
        );
        captureAppError(error, { module: "notifications", operation: "notify:row" });
      }
    }
  } catch (error) {
    console.error(
      `[notifications] notify(${event.type}) failed`,
      { orgId, entityId: event.entityId },
      error
    );
    captureAppError(error, { module: "notifications", operation: `notify:${event.type}` });
  }
}
