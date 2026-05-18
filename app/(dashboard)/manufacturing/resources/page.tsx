import { getManufacturingResources } from "@/lib/dal/manufacturing-resources";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { ManufacturingResourcesClient } from "./resources-client";

export default async function ManufacturingResourcesPage() {
  await requireModuleReadAccess("manufacturing");
  const resources = await getManufacturingResources();

  return <ManufacturingResourcesClient initialResources={resources} />;
}
