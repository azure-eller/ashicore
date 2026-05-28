import { redirect } from "next/navigation";
import { canManageTeam } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getDailyManufacturingReportSchedule } from "@/lib/dal/reports";
import { ReportsSection } from "../reports-section";

export default async function SettingsReportsPage() {
  const context = await getAuthedMemberContext();

  if (!canManageTeam(context.assignedRoles)) {
    redirect("/settings/account");
  }

  const reportScheduleData = await getDailyManufacturingReportSchedule();

  return <ReportsSection initialData={reportScheduleData} />;
}
