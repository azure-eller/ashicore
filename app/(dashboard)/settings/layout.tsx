import { requireModuleReadAccess } from "@/lib/dal/auth";
import { SettingsHeader } from "./settings-header";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("settings");

  return (
    <>
      <SettingsHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}
