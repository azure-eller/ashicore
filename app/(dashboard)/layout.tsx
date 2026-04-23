import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/app/providers";
import { ReadabilityPreferenceBootstrap } from "./readability-preference-bootstrap";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { canWriteModule } from "@/lib/authz";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getAuthedMemberContext();
  const user = {
    name: context.name,
    email: context.email,
    avatar: context.avatar,
  };
  const agentEnabled = canWriteModule(context.assignedRoles, "sales");

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
