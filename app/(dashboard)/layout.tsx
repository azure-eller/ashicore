import { after } from "next/server";
import { DashboardTopNav } from "@/components/dashboard-top-nav";
import { TimeZoneProvider } from "@/components/time-zone-provider";
import { DashboardNavigationContent } from "@/components/navigation-pending";
import {
  getAuthedMemberContext,
  getAuthedOrganizations,
} from "@/lib/dal/auth";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";
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
  const [organizations, wholesaleAccess] = await Promise.all([
    getAuthedOrganizations(),
    getFeatureAccessForCurrentOrg("wholesale_pricing"),
  ]);
  const user = {
    name: context.name,
    email: context.email,
    avatar: context.avatar,
  };

  return (
    <TimeZoneProvider timeZone={context.organizationTimeZone}>
      <div className="flex h-dvh w-dvw min-w-0 flex-col overflow-hidden bg-[var(--color-bg)]">
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
          hiddenNavHrefs={wholesaleAccess.locked ? ["/sales/pricing"] : []}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <DashboardNavigationContent>{children}</DashboardNavigationContent>
        </main>
      </div>
    </TimeZoneProvider>
  );
}
