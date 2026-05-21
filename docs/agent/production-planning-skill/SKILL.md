---
name: production-planning
description: Retrieve Ashicore ERP raw production data for manufacturing, inventory, and sales-order reasoning.
---

# Ashicore Production Planning

Use the Ashicore production-planning API when the user asks what products to
make, what bag/tote/pallet demand exists, what open manufacturing supply exists,
or what product inventory is on hand.

## API

```txt
GET https://ashicore.app/api/agent/production-planning/context
Authorization: Bearer <ASHICORE_AGENT_API_TOKEN>
```

Optional query parameters:

- `includePlanningFacts=true|false`
- `includeLots=true|false`

## Reasoning Rules

- Treat the ERP response as raw production data, not as a precomputed decision.
- Use `openSalesOrders` for sales order dates, ship dates, line items,
  quantities, and allocation state.
- Use `openManufacturingOrders` for existing production supply.
- Use `productCounts` for current sellable product inventory, allocation totals, open
  sales demand, and open manufacturing supply.
- Use `productRequirements` for BOM constraints such as minimum lot age.
- Do not ask for or rely on sales prices, unit costs, draft action payloads, or
  material-purchasing recommendations.
- Do not claim to create, edit, reserve, allocate, purchase, or manufacture
  anything. The API is read-only.
