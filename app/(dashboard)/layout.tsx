import { after } from "next/server";
import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/app/providers";
import { ReadabilityPreferenceBootstrap } from "./readability-preference-bootstrap";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";
import { hasErpAgentAccess } from "@/lib/agent/erp/access-rules";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestContext = await getRequestLogContext();
  const context = await getAuthedMemberContext();
  const user = {
    name: context.name,
    email: context.email,
    avatar: context.avatar,
  };
  const agentEnabled = hasErpAgentAccess(context.assignedRoles);

  after(() => {
    logObservedEvent("rsc.dashboard_layout.complete", requestContext);
  });

  return (
    <Providers>
      <ReadabilityPreferenceBootstrap />
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
