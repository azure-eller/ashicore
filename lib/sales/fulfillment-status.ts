import { formatDate } from "@/lib/format";

export type SalesItemsFulfillmentState =
  | "available"
  | "expected"
  | "not_available"
  | "complete";

export type SalesIngredientsFulfillmentState =
  | "not_applicable"
  | "in_stock"
  | "expected"
  | "not_available"
  | "picked";

export type SalesProductionFulfillmentState =
  | "not_applicable"
  | "make"
  | "not_started"
  | "in_progress"
  | "done"
  | "blocked";

export type FulfillmentTone =
  | "destructive"
  | "muted"
  | "secondary"
  | "success"
  | "warning";

export type FulfillmentDisplayState = {
  label: string;
  tone: FulfillmentTone;
};

export function getSalesItemsDisplayState(
  state: SalesItemsFulfillmentState,
  expectedDate: string | null
): FulfillmentDisplayState {
  switch (state) {
    case "available":
      return { label: "Available", tone: "success" };
    case "expected":
      return {
        label: expectedDate ? `Expected ${formatDate(expectedDate)}` : "Expected",
        tone: "warning",
      };
    case "complete":
      return { label: "Complete", tone: "success" };
    case "not_available":
    default:
      return { label: "Not available", tone: "destructive" };
  }
}

export function getIngredientsDisplayState(
  state: SalesIngredientsFulfillmentState,
  expectedDate: string | null = null
): FulfillmentDisplayState {
  switch (state) {
    case "picked":
      return { label: "Picked", tone: "success" };
    case "in_stock":
      return { label: "In stock", tone: "success" };
    case "expected":
      return {
        label: expectedDate ? `Expected ${formatDate(expectedDate)}` : "Expected",
        tone: "warning",
      };
    case "not_available":
      return { label: "Not available", tone: "destructive" };
    case "not_applicable":
    default:
      return { label: "Not applicable", tone: "muted" };
  }
}

export function getProductionDisplayState(
  state: SalesProductionFulfillmentState
): FulfillmentDisplayState {
  switch (state) {
    case "blocked":
      return { label: "Blocked", tone: "destructive" };
    case "in_progress":
      return { label: "Work in progress", tone: "warning" };
    case "not_started":
      return { label: "Not started", tone: "muted" };
    case "done":
      return { label: "Done", tone: "success" };
    case "make":
      return { label: "Make", tone: "secondary" };
    case "not_applicable":
    default:
      return { label: "No production", tone: "muted" };
  }
}

export function getAvailabilityLabel(
  state: SalesItemsFulfillmentState,
  expectedDate: string | null
) {
  return getSalesItemsDisplayState(state, expectedDate).label;
}
