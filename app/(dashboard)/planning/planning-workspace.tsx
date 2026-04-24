"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatQuantity } from "@/lib/format";
import type {
  BomRequirementFact,
  DemandFact,
  InventoryFact,
  PlanningActionPayload,
  PlanningItemRow,
  PlanningRecommendation,
  PlanningReasonCode,
  PlanningSnapshot,
  PlanningSourceRef,
  SupplyFact,
} from "@/lib/planning/types";

type RowFilter = "shortages" | "all" | "buy" | "make" | "review";

type ActionResult = {
  id: string;
};

function reasonVariant(code: PlanningReasonCode): ComponentProps<typeof Badge>["variant"] {
  if (
    code.includes("missing") ||
    code.includes("ambiguous") ||
    code.includes("shortage") ||
    code.includes("stale") ||
    code.includes("duplicate")
  ) {
    return "destructive";
  }

  if (code.includes("supply") || code === "inventory_available" || code === "no_shortage") {
    return "secondary";
  }

  return "outline";
}

function actionLabel(recommendation: PlanningRecommendation | null) {
  if (!recommendation) return "None";

  switch (recommendation.recommendationType) {
    case "create_purchase_order":
      return "Buy";
    case "create_manufacturing_order":
      return "Make";
    case "review_item_setup":
      return "Review";
    case "none":
      return "None";
  }
}

function actionVariant(recommendation: PlanningRecommendation | null) {
  if (!recommendation || recommendation.recommendationType === "none") {
    return "secondary" as const;
  }

  if (recommendation.recommendationType === "review_item_setup") {
    return "destructive" as const;
  }

  return "default" as const;
}

function sourceRefsLabel(sourceRefs: PlanningSourceRef[]) {
  if (sourceRefs.length === 0) {
    return "No source refs";
  }

  return sourceRefs.map((ref) => `${ref.sourceType}:${ref.sourceId}`).join(", ");
}

function factDate(value: string | null) {
  return value ? formatDate(value) : "None";
}

function RecommendationActionButton({
  recommendation,
  onAction,
  isPending,
}: {
  recommendation: PlanningRecommendation | null;
  onAction: (payload: PlanningActionPayload) => void;
  isPending: boolean;
}) {
  if (!recommendation?.actionPayload) {
    return null;
  }

  const label =
    recommendation.actionPayload.actionType === "create_purchase_order"
      ? "Create PO Draft"
      : "Create WO Draft";

  return (
    <Button
      size="sm"
      onClick={() => onAction(recommendation.actionPayload!)}
      disabled={isPending}
    >
      <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
      {isPending ? "Creating..." : label}
    </Button>
  );
}

function ReasonBadges({ codes }: { codes: PlanningReasonCode[] }) {
  return (
    <div className="flex max-w-md flex-wrap gap-1.5">
      {codes.map((code) => (
        <Badge key={code} variant={reasonVariant(code)}>
          {code}
        </Badge>
      ))}
    </div>
  );
}

function SourceRefs({ refs }: { refs: PlanningSourceRef[] }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {refs.map((ref) => (
        <div key={sourceRefsLabel([ref])}>
          <span className="font-medium text-foreground">{ref.sourceType}</span>{" "}
          {ref.label}
          {ref.quantity ? ` (${formatQuantity(ref.quantity)})` : ""}
        </div>
      ))}
    </div>
  );
}

function DemandFactsTable({ facts }: { facts: DemandFact[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Demand</TableHead>
          <TableHead>Qty</TableHead>
          <TableHead>Required</TableHead>
          <TableHead>Reason Codes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {facts.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4}>No demand facts.</TableCell>
          </TableRow>
        ) : (
          facts.map((fact) => (
            <TableRow key={fact.id}>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{fact.demandType}</span>
                  <span className="text-xs text-muted-foreground">{fact.explanation}</span>
                </div>
              </TableCell>
              <TableCell>{formatQuantity(fact.quantity)}</TableCell>
              <TableCell>{factDate(fact.requiredDate)}</TableCell>
              <TableCell>
                <ReasonBadges codes={fact.reasonCodes} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function SupplyFactsTable({ facts }: { facts: SupplyFact[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Supply</TableHead>
          <TableHead>Qty</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Reason Codes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {facts.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4}>No supply facts.</TableCell>
          </TableRow>
        ) : (
          facts.map((fact) => (
            <TableRow key={fact.id}>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{fact.supplyType}</span>
                  <span className="text-xs text-muted-foreground">{fact.explanation}</span>
                </div>
              </TableCell>
              <TableCell>{formatQuantity(fact.quantity)}</TableCell>
              <TableCell>{factDate(fact.expectedDate)}</TableCell>
              <TableCell>
                <ReasonBadges codes={fact.reasonCodes} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function InventoryFactsTable({ fact }: { fact: InventoryFact | null }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>On Hand</TableHead>
          <TableHead>Reserved</TableHead>
          <TableHead>Available</TableHead>
          <TableHead>Expected</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>{formatQuantity(fact?.onHandQuantity)}</TableCell>
          <TableCell>{formatQuantity(fact?.reservedQuantity)}</TableCell>
          <TableCell>{formatQuantity(fact?.availableQuantity)}</TableCell>
          <TableCell>{formatQuantity(fact?.expectedQuantity)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function BomFactsTable({ facts }: { facts: BomRequirementFact[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Parent</TableHead>
          <TableHead>Component</TableHead>
          <TableHead>Qty</TableHead>
          <TableHead>Level</TableHead>
          <TableHead>Reason Codes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {facts.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5}>No BOM explosion facts.</TableCell>
          </TableRow>
        ) : (
          facts.map((fact) => (
            <TableRow key={fact.id}>
              <TableCell>{fact.parentItemId}</TableCell>
              <TableCell>{fact.componentItemId}</TableCell>
              <TableCell>{formatQuantity(fact.requiredQuantity)}</TableCell>
              <TableCell>{fact.level}</TableCell>
              <TableCell>
                <ReasonBadges codes={fact.reasonCodes} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function DrilldownDialog({
  row,
  snapshot,
  recommendation,
  onOpenChange,
  onAction,
  isPending,
}: {
  row: PlanningItemRow | null;
  snapshot: PlanningSnapshot;
  recommendation: PlanningRecommendation | null;
  onOpenChange: (open: boolean) => void;
  onAction: (payload: PlanningActionPayload) => void;
  isPending: boolean;
}) {
  const demandFacts = row
    ? snapshot.demandFacts.filter((fact) => fact.itemId === row.item.id)
    : [];
  const supplyFacts = row
    ? snapshot.supplyFacts.filter((fact) => fact.itemId === row.item.id)
    : [];
  const inventoryFact = row
    ? snapshot.inventoryFacts.find((fact) => fact.itemId === row.item.id) ?? null
    : null;
  const bomFacts = row
    ? snapshot.bomRequirementFacts.filter(
        (fact) => fact.componentItemId === row.item.id || fact.parentItemId === row.item.id
      )
    : [];

  return (
    <Dialog open={row != null} onOpenChange={onOpenChange}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>{row?.item.name ?? "Planning detail"}</DialogTitle>
          <DialogDescription>{row?.explanationSummary}</DialogDescription>
        </DialogHeader>

        {row ? (
          <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={actionVariant(recommendation)}>
                {actionLabel(recommendation)}
              </Badge>
              <ReasonBadges codes={row.reasonCodes} />
            </div>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Inventory</h2>
              <InventoryFactsTable fact={inventoryFact} />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Demand Sources</h2>
              <DemandFactsTable facts={demandFacts} />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Supply Sources</h2>
              <SupplyFactsTable facts={supplyFacts} />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">BOM Explosion</h2>
              <BomFactsTable facts={bomFacts} />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Source References</h2>
              <SourceRefs refs={row.sourceRefs} />
            </section>

            {recommendation ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">Recommendation</h2>
                <p className="text-sm text-muted-foreground">{recommendation.explanation}</p>
                <ReasonBadges codes={recommendation.reasonCodes} />
              </section>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <RecommendationActionButton
            recommendation={recommendation}
            onAction={onAction}
            isPending={isPending}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlanningWorkspace({
  initialSnapshot,
}: {
  initialSnapshot: PlanningSnapshot;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RowFilter>("shortages");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: snapshot = initialSnapshot } = useQuery<PlanningSnapshot>({
    queryKey: ["planning"],
    queryFn: async () => {
      const response = await fetch("/api/planning");
      if (!response.ok) {
        throw new Error("Failed to fetch planning snapshot");
      }
      return response.json();
    },
    initialData: initialSnapshot,
  });

  const recommendationsById = useMemo(
    () => new Map(snapshot.recommendations.map((entry) => [entry.id, entry])),
    [snapshot.recommendations]
  );

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return snapshot.rows.filter((row) => {
      const recommendation = row.recommendationId
        ? recommendationsById.get(row.recommendationId) ?? null
        : null;
      const matchesSearch =
        normalizedSearch === "" ||
        row.item.name.toLowerCase().includes(normalizedSearch) ||
        (row.item.sku ?? "").toLowerCase().includes(normalizedSearch) ||
        row.reasonCodes.some((code) => code.includes(normalizedSearch)) ||
        row.sourceRefs.some(
          (ref) =>
            ref.label.toLowerCase().includes(normalizedSearch) ||
            ref.sourceType.includes(normalizedSearch)
        );
      const matchesFilter =
        filter === "all" ||
        (filter === "shortages" && Number(row.shortageQuantity) > 0) ||
        (filter === "buy" && recommendation?.recommendationType === "create_purchase_order") ||
        (filter === "make" &&
          recommendation?.recommendationType === "create_manufacturing_order") ||
        (filter === "review" && recommendation?.recommendationType === "review_item_setup");

      return matchesSearch && matchesFilter;
    });
  }, [filter, recommendationsById, search, snapshot.rows]);

  const selectedRow =
    rows.find((row) => row.item.id === selectedRowId) ??
    snapshot.rows.find((row) => row.item.id === selectedRowId) ??
    null;
  const selectedRecommendation = selectedRow?.recommendationId
    ? recommendationsById.get(selectedRow.recommendationId) ?? null
    : null;

  const actionMutation = useMutation<ActionResult, Error, PlanningActionPayload>({
    mutationFn: async (payload) => {
      const endpoint =
        payload.actionType === "create_purchase_order"
          ? "/api/planning/actions/purchase-order"
          : "/api/planning/actions/manufacturing-order";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to create draft.");
      }

      return body;
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (result, payload) => {
      await queryClient.invalidateQueries({ queryKey: ["planning"] });
      if (payload.actionType === "create_purchase_order") {
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        router.push(`/purchasing/orders/${result.id}`);
      } else {
        await queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
        router.push(`/manufacturing/orders/${result.id}`);
      }
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Planning</h1>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>Generated {snapshot.generatedAt.replace("T", " ").slice(0, 19)}</span>
            <span>Input {snapshot.inputHash.slice(0, 12)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label="Search planning"
            placeholder="Search..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full sm:w-72"
          />
          <Select value={filter} onValueChange={(value) => setFilter(value as RowFilter)}>
            <SelectTrigger aria-label="Filter planning rows" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="shortages">Shortages</SelectItem>
                <SelectItem value="all">All rows</SelectItem>
                <SelectItem value="buy">Buy</SelectItem>
                <SelectItem value="make">Make</SelectItem>
                <SelectItem value="review">Review</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Demand</TableHead>
              <TableHead>Available</TableHead>
              <TableHead>Reserved</TableHead>
              <TableHead>PO</TableHead>
              <TableHead>MO</TableHead>
              <TableHead>Projected</TableHead>
              <TableHead>Shortage</TableHead>
              <TableHead>Reasons</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11}>No planning rows match the current filters.</TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const recommendation = row.recommendationId
                  ? recommendationsById.get(row.recommendationId) ?? null
                  : null;

                return (
                  <TableRow key={row.item.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{row.item.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {[row.item.sku, row.item.unitName].filter(Boolean).join(" / ") ||
                            row.item.itemType}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionVariant(recommendation)}>
                        {actionLabel(recommendation)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatQuantity(row.demandQuantity)}</TableCell>
                    <TableCell>{formatQuantity(row.availableStock)}</TableCell>
                    <TableCell>{formatQuantity(row.reservedQuantity)}</TableCell>
                    <TableCell>{formatQuantity(row.incomingPurchaseOrderQuantity)}</TableCell>
                    <TableCell>{formatQuantity(row.incomingManufacturingOrderQuantity)}</TableCell>
                    <TableCell>{formatQuantity(row.projectedQuantity)}</TableCell>
                    <TableCell>{formatQuantity(row.shortageQuantity)}</TableCell>
                    <TableCell>
                      <ReasonBadges codes={row.reasonCodes} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedRowId(row.item.id)}
                        >
                          Drilldown
                        </Button>
                        <RecommendationActionButton
                          recommendation={recommendation}
                          onAction={(payload) => actionMutation.mutate(payload)}
                          isPending={actionMutation.isPending}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <DrilldownDialog
        row={selectedRow}
        snapshot={snapshot}
        recommendation={selectedRecommendation}
        onOpenChange={(open) => {
          if (!open) setSelectedRowId(null);
        }}
        onAction={(payload) => actionMutation.mutate(payload)}
        isPending={actionMutation.isPending}
      />
    </div>
  );
}
