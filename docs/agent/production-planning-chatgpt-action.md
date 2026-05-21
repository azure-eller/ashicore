# Production Planning Agent Action

This integration lets ChatGPT or Claude retrieve Ashicore production-planning
context with a read-only bearer token.

## Endpoint

```txt
GET https://ashicore.app/api/agent/production-planning/context
```

The default response is raw JSON production data for ChatGPT Actions: open sales
orders, open manufacturing orders, product counts, and product requirements.

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

Treat the ERP response as raw production data, not as a precomputed
recommendation. Use:

- `openSalesOrders` for sales order dates, ship dates, line items, quantities,
  and allocation state.
- `openManufacturingOrders` for existing production supply.
- `productCounts` for current sellable product inventory, allocation totals, open sales
  demand, and open manufacturing supply.
- `productRequirements` for BOM requirements such as minimum lot age.

The agent-facing response intentionally omits sales prices, unit costs, draft
action payloads, and material-purchasing recommendations. This is production
data only.

Do not tell the user that manufacturing orders, purchase orders, or allocations
were created. This integration is read-only.
