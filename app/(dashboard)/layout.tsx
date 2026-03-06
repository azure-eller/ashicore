import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/app/providers";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = {
    name: session?.user.name ?? "",
    email: session?.user.email ?? "",
    avatar: session?.user.image ?? undefined,
  };

  return (
    <Providers>
      <SidebarProvider>
        <AppSidebar user={user} />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </Providers>
  );
}
