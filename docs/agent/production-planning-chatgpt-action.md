# Production Planning Agent Action

This integration lets ChatGPT or Claude retrieve Ashicore production-planning
context with a read-only bearer token.

## Endpoint

```txt
GET https://ashicore.app/api/agent/production-planning/context
```

OpenAPI schema:

```txt
https://ashicore.app/.well-known/ashicore-agent-production-planning-openapi.json
```

## Token Setup

Create a token from an authenticated owner or settings-admin session:

```bash
curl -X POST https://ashicore.app/api/agent/api-tokens \
  -H "Content-Type: application/json" \
  -H "Cookie: <signed-in browser session cookie>" \
  -d '{"name":"ChatGPT production planner"}'
```

The response includes `token` once. Store it in the GPT/Claude action
configuration and do not paste it into normal chat messages.

## ChatGPT Action Setup

1. Create or edit a Custom GPT.
2. Add an Action.
3. Import the OpenAPI schema URL above.
4. Set authentication to API key or bearer-token auth.
5. Configure it to send:

```txt
Authorization: Bearer <agent token>
```

OpenAI's GPT Actions documentation describes API-key/bearer authentication and
OpenAPI-schema setup:

- https://platform.openai.com/docs/actions/authentication
- https://platform.openai.com/docs/actions/getting-started/getting-started

## Assistant Instructions

Use the `getProductionPlanningContext` action whenever the user asks what to
make, what is short, what can be allocated, what open supply exists, or what is
blocking production.

Treat the ERP response as the source of truth. Do not infer available stock from
raw on-hand quantities. Use:

- `planning.assumptions`, `horizonStart`, and `horizonEnd` to explain the
  planning basis.
- `summary` and `attentionQueue` as indexes into the full data, not as filters.
- `salesOrders`, `manufacturingOrders`, `purchaseOrders`, `inventory`, and
  `allocations` as the complete current board state.
- `inventory.availableQty` as current usable on-hand after reservations.
- `inventory.projectedQty` as planning-derived future net quantity.
- `inventory.inventoryLotAllocatedQty` for physical lot allocations.
- `inventory.manufacturingOutputAllocatedQty` for allocations of future MO
  output.
- `inputHash` when explaining that recommendations are based on the returned
  snapshot.

Do not tell the user that manufacturing orders, purchase orders, or allocations
were created. This integration is read-only.
