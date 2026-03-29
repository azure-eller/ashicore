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
      <div className="flex flex-1 flex-col p-4 md:px-6 md:py-5">
        <div className="grid gap-6 lg:grid-cols-[160px_minmax(0,1fr)] lg:items-start">
          <aside>
            <SettingsNav sections={sections} />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </>
  );
}
