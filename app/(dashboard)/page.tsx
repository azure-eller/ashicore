import { redirect } from "next/navigation";
import { getDefaultDashboardPath } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";

export default async function HomePage() {
  const context = await getAuthedMemberContext();
  redirect(getDefaultDashboardPath(context.assignedRoles));
}
