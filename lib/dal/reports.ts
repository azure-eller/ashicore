import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  assertModuleReadAccess,
  assertTeamManagementAccess,
  getAuthedApiMemberContext,
  requireTeamManagementAccess,
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import {
  member,
  notifications,
  reportRecipients,
  reportSchedules,
  user,
} from "@/lib/db/schema";
import { REPORT_TYPES } from "@/lib/reports/constants";
import { normalizeDailyManufacturingReportConfig } from "@/lib/reports/daily-manufacturing-config";
import type { UpdateDailyManufacturingReportScheduleInput } from "@/lib/schemas/reports";

export type ReportScheduleMember = {
  userId: string;
  name: string;
  email: string;
};

export async function getDailyManufacturingReportSchedule() {
  const context = await requireTeamManagementAccess();

  return withAuthedOrgContext(async (tx, orgId) => {
    const [schedule] = await tx
      .insert(reportSchedules)
      .values({
        organizationId: orgId,
        reportType: REPORT_TYPES.DAILY_MANUFACTURING,
        enabled: false,
        emailEnabled: true,
        timeZone: context.organizationTimeZone,
        config: {},
      })
      .onConflictDoUpdate({
        target: [reportSchedules.organizationId, reportSchedules.reportType],
        set: {
          updatedAt: sql`${reportSchedules.updatedAt}`,
        },
      })
      .returning();

    const [memberRows, recipientRows] = await Promise.all([
      tx
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, orgId))
        .orderBy(asc(user.name), asc(user.email)),
      tx
        .select({ userId: reportRecipients.userId })
        .from(reportRecipients)
        .where(eq(reportRecipients.scheduleId, schedule.id)),
    ]);

    return {
      schedule: {
        ...schedule,
        config: normalizeDailyManufacturingReportConfig(schedule.config),
      },
      members: memberRows,
      recipientUserIds: recipientRows.map((row) => row.userId),
    };
  });
}

export async function getDailyManufacturingReportScheduleForRequest(
  requestHeaders: HeadersInit
) {
  await assertTeamManagementAccess(requestHeaders);
  return getDailyManufacturingReportSchedule();
}

export async function updateDailyManufacturingReportSchedule(
  requestHeaders: HeadersInit,
  input: UpdateDailyManufacturingReportScheduleInput
) {
  const actor = await assertTeamManagementAccess(requestHeaders);
  const sendTime = `${input.localSendTime}:00`;
  const config = normalizeDailyManufacturingReportConfig({
    productTypeGraphs: input.productTypeGraphs,
  });

  return withAuthedOrgContext(async (tx, orgId) => {
    const validRecipients = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(
        input.recipientUserIds.length > 0
          ? and(
              eq(member.organizationId, orgId),
              inArray(member.userId, input.recipientUserIds)
            )
          : sql`false`
      );
    const validRecipientIds = new Set(validRecipients.map((row) => row.userId));

    const [schedule] = await tx
      .insert(reportSchedules)
      .values({
        organizationId: orgId,
        reportType: REPORT_TYPES.DAILY_MANUFACTURING,
        enabled: input.enabled,
        emailEnabled: input.emailEnabled,
        localSendTime: sendTime,
        timeZone: input.timeZone || actor.organizationTimeZone,
        config,
      })
      .onConflictDoUpdate({
        target: [reportSchedules.organizationId, reportSchedules.reportType],
        set: {
          enabled: input.enabled,
          emailEnabled: input.emailEnabled,
          localSendTime: sendTime,
          timeZone: input.timeZone,
          config,
          updatedAt: new Date(),
        },
      })
      .returning();

    await tx
      .delete(reportRecipients)
      .where(eq(reportRecipients.scheduleId, schedule.id));

    const recipientRows = input.recipientUserIds
      .filter((userId) => validRecipientIds.has(userId))
      .map((userId) => ({
        organizationId: orgId,
        scheduleId: schedule.id,
        userId,
      }));

    if (recipientRows.length > 0) {
      await tx.insert(reportRecipients).values(recipientRows);
    }

    const memberRows = await tx
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, orgId))
      .orderBy(asc(user.name), asc(user.email));

    return {
      schedule: {
        ...schedule,
        config: normalizeDailyManufacturingReportConfig(schedule.config),
      },
      members: memberRows,
      recipientUserIds: recipientRows.map((row) => row.userId),
    };
  });
}

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
      notifications: rows,
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

export type DailyManufacturingReportScheduleData = Awaited<
  ReturnType<typeof getDailyManufacturingReportSchedule>
>;
