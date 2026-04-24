import { Suspense } from "react";
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
  await requirePlanningReadAccess();
  const snapshot = await getPlanningSnapshot();
  return <PlanningWorkspace initialSnapshot={snapshot} />;
}
