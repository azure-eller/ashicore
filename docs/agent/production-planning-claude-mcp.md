# Ashicore Claude MCP

Claude web uses a remote MCP server, not the ChatGPT OpenAPI Action schema.

Settings > Agent API shows the remote MCP URL:

```txt
https://ashicore.app/api/agent/mcp
```

In Claude:

1. Go to Settings > Connectors.
2. Add a custom connector.
3. Name it `Ashicore`.
4. Paste the remote MCP URL.
5. Leave OAuth Client ID and OAuth Client Secret blank.
6. Connect and approve Ashicore access.

The MCP server exposes read-only tools:

```txt
get_production_planning_context
get_replenishment_context
```

`get_production_planning_context` returns the same compact production JSON used
by the ChatGPT Action:

- open sales orders with shipment buckets and unplanned demand
- open manufacturing orders
- sellable product counts with lot received dates
- product-to-product BOM requirements

`get_replenishment_context` returns purchased-material replenishment facts with
a compact `summary` view and a one-item `detail` view. It is intentionally
read-only and omits safety stock, urgency labels, risk scores, stockout dates,
and recommended quantities.

The connector is OAuth-authenticated and scoped to the signed-in user's active
organization.

Claude supports prefilled custom connector install links. Ashicore can link users
to:

```txt
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Ashicore&connectorUrl=https%3A%2F%2Fashicore.app%2Fapi%2Fagent%2Fmcp
```

Users still confirm the connector and complete OAuth in Claude.
