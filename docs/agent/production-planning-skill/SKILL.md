---
name: production-planning
description: Retrieve Ashicore ERP production-planning context for manufacturing, allocation, inventory, purchasing, and sales-order reasoning.
---

# Ashicore Production Planning

Use the Ashicore production-planning API when the user asks what to make, what
to allocate, what is short, what open supply exists, or what is blocking
production.

## API

```txt
GET https://ashicore.app/api/agent/production-planning/context
Authorization: Bearer <ASHICORE_AGENT_API_TOKEN>
```

Optional query parameters:

- `includePlanningFacts=true|false`
- `includeLots=true|false`

Default both to `true` unless the response is too large.

## Reasoning Rules

- Treat the ERP response as the source of truth.
- Use `summary` and `attentionQueue` only as navigation aids into the full
  returned context.
- Start with `decisionSupport.decisionQueue` when answering what to do next.
  It combines allocation, make/buy, item setup, and blocker decisions.
- Use `decisionSupport.allocationNeeds` as the allocation queue. It is ordered
  for planning and includes per-item remaining availability so one lot of stock
  is not counted against multiple demands.
- Use `decisionSupport.supplyRecommendations` for make/buy/review planning
  advice.
- Do not infer usable stock from raw on-hand quantities.
- `inventory.availableQty` means current usable on-hand after reservations.
- `inventory.projectedQty` means planning-derived future net quantity after
  demand and open supply.
- `inventory.inventoryLotAllocatedQty` means physical inventory already
  allocated from lots.
- `inventory.manufacturingOutputAllocatedQty` means future manufacturing output
  already allocated.
- Always mention important `planning.assumptions`, `horizonStart`, `horizonEnd`,
  and `inputHash` when giving production recommendations.
- Do not ask for or rely on sales prices, unit costs, draft action payloads, or
  per-parent recipe ratios. They are intentionally not part of this agent
  context.
- Do not claim to create, edit, reserve, allocate, purchase, or manufacture
  anything. The API is read-only.
