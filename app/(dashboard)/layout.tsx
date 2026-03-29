import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/app/providers";
import { getAuthedMemberContext } from "@/lib/dal/auth";
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

  return (
    <Providers>
      <SidebarProvider>
        <AppSidebar
          user={user}
          role={context.role}
          organizationName={context.organizationName}
        />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </Providers>
  );
}
