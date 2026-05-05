import { after } from "next/server";
import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/app/providers";
import { getAuthedMemberContext } from "@/lib/dal/auth";
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
  const user = {
    name: context.name,
    email: context.email,
    avatar: context.avatar,
  };

  return (
    <Providers>
      <SidebarProvider>
        <AppSidebar
          user={user}
          assignedRoles={context.assignedRoles}
          organizationName={context.organizationName}
        />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </Providers>
  );
}
