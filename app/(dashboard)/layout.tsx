import { after } from "next/server";
import { DashboardTopNav } from "@/components/dashboard-top-nav";
import { FeedbackWidget } from "@/components/feedback-widget";
import { TimeZoneProvider } from "@/components/time-zone-provider";
import { DashboardNavigationContent } from "@/components/navigation-pending";
import {
  getAuthedMemberContext,
  getAuthedOrganizations,
} from "@/lib/dal/auth";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestContextPromise = getRequestLogContext();

  after(async () => {
    const requestContext = await requestContextPromise;
    logObservedEvent("rsc.dashboard_layout.complete", requestContext);
  });

  const context = await getAuthedMemberContext();
  const organizations = await getAuthedOrganizations();
  const user = {
    name: context.name,
    email: context.email,
    avatar: context.avatar,
  };

  return (
    <TimeZoneProvider timeZone={context.organizationTimeZone}>
      <div className="flex min-h-screen w-full flex-col bg-background">
        <DashboardTopNav
          user={user}
          assignedRoles={context.assignedRoles}
          activeOrganizationId={context.orgId}
          organizationName={context.organizationName}
          organizations={organizations.map((organization) => ({
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
          }))}
        />
        <main className="flex min-h-0 flex-1 flex-col">
          <DashboardNavigationContent>{children}</DashboardNavigationContent>
        </main>
        <FeedbackWidget />
      </div>
    </TimeZoneProvider>
  );
}
