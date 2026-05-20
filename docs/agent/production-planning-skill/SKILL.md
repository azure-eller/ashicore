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
- Do not claim to create, edit, reserve, allocate, purchase, or manufacture
  anything. The API is read-only.
