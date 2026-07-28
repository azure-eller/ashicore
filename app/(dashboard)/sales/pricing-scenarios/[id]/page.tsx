import { redirect } from "next/navigation";
import {
  getPricingScenarioDetail,
  getPricingScenarioProductOptions,
} from "@/lib/dal/pricing-scenarios";
import {
  getOverheadSettings,
  getDefaultOverheadPeriod,
} from "@/lib/dal/overhead-settings";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import type { PricingScenarioDetailData } from "@/lib/api/clients/pricing-scenarios";
import { PricingScenarioCard } from "./scenario-card";

export default async function PricingScenarioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isNew = id === "new";
  const [detail, productOptions, overheadSettings, memberContext] =
    await Promise.all([
      isNew ? null : getPricingScenarioDetail(id),
      getPricingScenarioProductOptions(),
      getOverheadSettings(),
      getAuthedMemberContext(),
    ]);

  if (!isNew && !detail) {
    redirect("/sales/pricing-scenarios");
  }

  return (
    <PricingScenarioCard
      initialScenarioId={isNew ? null : id}
      initialDetail={detail as unknown as PricingScenarioDetailData | null}
      productOptions={productOptions}
      overheadSettings={overheadSettings}
      overheadDefaultPeriod={getDefaultOverheadPeriod()}
      overheadCanOperate={hasModuleAccess(
        memberContext.assignedRoles,
        "sales",
        "operate"
      )}
    />
  );
}
