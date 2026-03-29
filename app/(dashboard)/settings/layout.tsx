import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { getSettingsSections } from "./sections";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireModuleReadAccess("settings");
  const sections = getSettingsSections(context.role);

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <span className="text-sm font-medium">Settings</span>
      </div>
      <div className="flex flex-1 flex-col p-4 md:p-6">
        <div className="mx-auto w-full max-w-6xl space-y-8">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Manage your account, interface preferences, and workspace controls.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <SettingsNav sections={sections} />
            </aside>
            <div className="min-w-0">{children}</div>
          </div>
        </div>
      </div>
    </>
  );
}
