import { after } from "next/server";
import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/app/providers";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";
import { isErpAgentEnabled } from "@/lib/feature-flags";
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
  const agentEnabled = await getAgentEnabled(context.assignedRoles);

  return (
    <Providers>
      <SidebarProvider>
        <AppSidebar
          user={user}
          assignedRoles={context.assignedRoles}
          organizationName={context.organizationName}
          agentEnabled={agentEnabled}
        />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </Providers>
  );
}

async function getAgentEnabled(assignedRoles: string[]) {
  if (!isErpAgentEnabled()) {
    return false;
  }

  const { hasErpAgentAccess } = await import("@/lib/agent/erp/access-rules");
  return hasErpAgentAccess(assignedRoles);
}
