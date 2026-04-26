import { Suspense } from "react";
import { hasModuleAccess } from "@/lib/authz";
import { requirePlanningReadAccess } from "@/lib/planning/auth";
import { getPlanningSnapshot } from "@/lib/planning/service";
import { PlanningWorkspace } from "./planning-workspace";
import PlanningLoading from "./loading";

export default function PlanningPage() {
  return (
    <Suspense fallback={<PlanningLoading />}>
      <PlanningData />
    </Suspense>
  );
}

async function PlanningData() {
  const context = await requirePlanningReadAccess();
  const snapshot = await getPlanningSnapshot();
  return (
    <PlanningWorkspace
      initialSnapshot={snapshot}
      permissions={{
        canCreatePurchaseOrders: hasModuleAccess(
          context.assignedRoles,
          "purchasing",
          "operate"
        ),
        canCreateManufacturingOrders: hasModuleAccess(
          context.assignedRoles,
          "manufacturing",
          "operate"
        ),
        canUpdatePlanningRules: hasModuleAccess(
          context.assignedRoles,
          "inventory",
          "operate"
        ),
      }}
    />
  );
}
