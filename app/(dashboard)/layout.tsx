import { after } from "next/server";
import { AppSidebar } from "@/components/app-sidebar";
import { FeedbackWidget } from "@/components/feedback-widget";
import { Providers } from "@/app/providers";
import { TimeZoneProvider } from "@/components/time-zone-provider";
import {
  getAuthedMemberContext,
  getAuthedOrganizations,
} from "@/lib/dal/auth";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

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
    <Providers>
      <TimeZoneProvider timeZone={context.organizationTimeZone}>
        <SidebarProvider>
          <AppSidebar
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
          <SidebarInset>{children}</SidebarInset>
          <FeedbackWidget />
        </SidebarProvider>
      </TimeZoneProvider>
    </Providers>
  );
}
