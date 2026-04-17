import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/app/providers";
import { ReadabilityProvider } from "@/app/readability-provider";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { canWriteModule } from "@/lib/authz";
import { getUserReadability } from "./settings/queries";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [context, readability] = await Promise.all([
    getAuthedMemberContext(),
    getUserReadability(),
  ]);
  const user = {
    name: context.name,
    email: context.email,
    avatar: context.avatar,
  };
  const agentEnabled = canWriteModule(context.assignedRoles, "sales");

  return (
    <Providers>
      <ReadabilityProvider initial={readability}>
        <SidebarProvider>
          <AppSidebar
            user={user}
            assignedRoles={context.assignedRoles}
            organizationName={context.organizationName}
            agentEnabled={agentEnabled}
          />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </ReadabilityProvider>
    </Providers>
  );
}
