import { apiClientJson, apiJson } from "@/lib/client/api";
import type {
  PricingScenarioDetail,
  PricingScenarioListRow,
  PricingScenarioRevisionDetail,
} from "@/lib/dal/pricing-scenarios";
import type {
  InsertPricingScenario,
  UpdatePricingScenario,
} from "@/lib/schemas/pricing-scenarios";

const json = apiClientJson;

type DocSaveOptions = {
  idempotencyKey: string;
  keepalive?: boolean;
};

/** DAL row types cross the JSON boundary with dates as strings. */
export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};

export type PricingScenarioListItem = Serialized<PricingScenarioListRow>;
export type PricingScenarioRevisionItem = Serialized<
  PricingScenarioDetail["revisions"][number]
>;
export type PricingScenarioDetailData = Omit<
  PricingScenarioDetail,
  "scenario" | "revisions"
> & {
  scenario: Serialized<PricingScenarioDetail["scenario"]>;
  revisions: PricingScenarioRevisionItem[];
};
export type PricingScenarioRevisionData = Serialized<
  Omit<PricingScenarioRevisionDetail, "snapshot">
> & { snapshot: PricingScenarioRevisionDetail["snapshot"] };

export async function getPricingScenarioDetailData(scenarioId: string) {
  return json<PricingScenarioDetailData>(
    `/api/pricing-scenarios/${scenarioId}`,
    undefined,
    "Failed to load pricing scenario."
  );
}

// Kernel save adapters use apiJson directly: the thrown ApiJsonError carries
// the response body, which the kernel reads for 409 {conflict, current}.
export async function createPricingScenarioDoc(
  payload: InsertPricingScenario,
  opts: DocSaveOptions
) {
  return apiJson<PricingScenarioDetailData>("/api/pricing-scenarios", {
    method: "POST",
    body: payload,
    idempotencyKey: opts.idempotencyKey,
    keepalive: opts.keepalive,
    fallbackError: "Failed to create pricing scenario.",
  });
}

export async function updatePricingScenarioDoc(
  scenarioId: string,
  payload: Omit<UpdatePricingScenario, "expectedVersion">,
  opts: DocSaveOptions & { expectedVersion: number | null }
) {
  return apiJson<PricingScenarioDetailData>(`/api/pricing-scenarios/${scenarioId}`, {
    method: "PATCH",
    body: { ...payload, expectedVersion: opts.expectedVersion ?? undefined },
    idempotencyKey: opts.idempotencyKey,
    keepalive: opts.keepalive,
    fallbackError: "Failed to save pricing scenario.",
  });
}

export async function deletePricingScenario(scenarioId: string) {
  return json<{ success: boolean }>(
    `/api/pricing-scenarios/${scenarioId}`,
    { method: "DELETE" },
    "Failed to delete pricing scenario."
  );
}

export async function duplicatePricingScenarioDoc(scenarioId: string) {
  return json<PricingScenarioDetailData>(
    `/api/pricing-scenarios/${scenarioId}/duplicate`,
    { method: "POST", body: {}, idempotencyKey: "duplicatePricingScenario" },
    "Failed to duplicate pricing scenario."
  );
}

export async function commitPricingScenarioRevisionDoc(
  scenarioId: string,
  note: string | null
) {
  return json<{ revision: PricingScenarioRevisionData }>(
    `/api/pricing-scenarios/${scenarioId}/revisions`,
    {
      method: "POST",
      body: { note },
      idempotencyKey: "commitPricingScenarioRevision",
    },
    "Failed to commit revision."
  );
}

export async function getPricingScenarioRevisionData(
  scenarioId: string,
  revisionId: string
) {
  return json<{ revision: PricingScenarioRevisionData }>(
    `/api/pricing-scenarios/${scenarioId}/revisions/${revisionId}`,
    undefined,
    "Failed to load revision."
  );
}
