// Shared between the generic `stage` agent tool (server) and the staging UI (client).
// A proposal is a validated DRAFT the agent stages for the user to review, edit, and
// approve. The agent never commits — approval replays `commitPayload` to the existing
// REST mutation route, which re-validates it. Keep this file free of server-only imports.

export type ProposalField = {
  label: string;
  /** Display value — resolved names and formatted numbers, never raw UUIDs. */
  value: string;
};

export type ProposalLine = {
  label: string;
  sublabel?: string | null;
  quantity: string;
  unitAmount: string;
  lineTotal: string;
};

/**
 * Optional editable line-item table (sales-order lines, PO lines, MO ingredients…).
 * The three `commit*Key` fields say where an edited line writes back into
 * `commitPayload`, so the staged preview and the replayed request stay in sync.
 */
export type ProposalLineTable = {
  quantityLabel: string;
  unitAmountLabel: string;
  totalLabel: string;
  lines: ProposalLine[];
  total: string;
  commitLinesKey: string;
  commitQuantityKey: string;
  commitUnitAmountKey: string;
};

export type HttpMutationMethod = "POST" | "PATCH" | "PUT";

export type AgentProposal = {
  /** Action name, e.g. "sales_order.create" — identifies the registry entry. */
  kind: string;
  module: string;
  /** Human title, e.g. "Sales order — Acme Co". */
  title: string;
  /** Past-tense subtitle shown after a successful commit, e.g. "Sales order created". */
  appliedLabel: string;
  /** Existing REST route + method the approved payload is replayed to. */
  commitPath: string;
  method: HttpMutationMethod;
  /** Exact request body sent on approval; the route re-validates it. */
  commitPayload: Record<string, unknown>;
  /** Header fields shown in the review card (customer, dates, notes…). */
  fields: ProposalField[];
  /** Optional editable line items. */
  lineTable?: ProposalLineTable | null;
};

export function isAgentProposal(value: unknown): value is AgentProposal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kind === "string" &&
    typeof v.title === "string" &&
    typeof v.commitPath === "string" &&
    typeof v.commitPayload === "object" &&
    v.commitPayload !== null &&
    Array.isArray(v.fields)
  );
}
