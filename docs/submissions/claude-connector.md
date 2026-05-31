# Claude Connector Directory Submission

Goal: get Ashicore listed as a Claude Connector so customers can find it in Claude and click Connect.

Official docs:
- Directory overview: https://claude.com/docs/connectors/directory
- Submission guide: https://claude.com/docs/connectors/building/submission
- Review checklist: https://claude.com/docs/connectors/building/review-criteria

Submit form:
- Remote MCP directory submission form, linked from the submission guide.

## Current Status

Have:
- Remote MCP URL: `https://ashicore.app/api/agent/mcp`
- OAuth flow for Claude custom connectors
- One read-only tool: `get_production_planning_context`
- Tool annotations: read-only, non-destructive, idempotent
- Settings flow for custom Claude connector

Need:
- Public documentation page for Ashicore Claude connector
- Privacy policy URL
- Support email or support page
- Logo asset
- Short tagline and long description
- Reviewer test account with populated demo ERP data
- Reviewer setup instructions
- Evidence that the connector was tested in Claude.ai as a custom connector
- Evidence that the MCP tool was tested through MCP Inspector

## Submission Copy

Name:
Ashicore

Tagline:
Production planning data from Ashicore ERP.

Description:
Ashicore connects Claude to production planning data from your ERP. Claude can read open sales shipments, open manufacturing orders, sellable product inventory, lot ages, and product BOM requirements to help create daily production schedules and identify shipment risks.

Primary use cases:
- Ask what to make today or this week.
- Build a daily production schedule from sales shipments and current inventory.
- Identify shipments at risk of missing.
- Review open manufacturing supply and aged inventory.

Category:
Business operations / ERP / Manufacturing

Auth type:
OAuth 2.0

Transport:
Remote MCP over HTTPS

Read/write capability:
Read-only

Data accessed:
- Open sales orders and shipment lines
- Open manufacturing orders
- Sellable product inventory counts
- Inventory lot received dates and available quantities
- Product BOM requirements

Data not accessed:
- Costs
- Prices
- Accounting records
- User conversation history

## Tool Inventory

Tool:
`get_production_planning_context`

Human name:
Get production planning context

Description:
Returns compact raw JSON for production planning: sales shipments, open manufacturing orders, sellable product counts with lots, and product BOM requirements.

Annotations:
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

## Reviewer Account

Need to create:
- Reviewer email
- Temporary password or invite flow
- Organization with Paonia-style demo data
- At least:
  - open sales orders with shipments
  - open manufacturing orders
  - product inventory lots with received dates
  - bag/tote BOMs with 7-day requirements

Reviewer instructions:
1. Open Claude.
2. Add Ashicore custom connector or use the directory candidate link.
3. Authenticate with the provided reviewer account.
4. Ask: “What should we make each day this week, and will we miss any shipments?”
5. Confirm Claude calls `get_production_planning_context`.

## Submission Checklist

- [ ] Public connector docs page is live.
- [ ] Privacy policy URL is live and covers data collection, usage, storage, sharing, retention, and contact.
- [ ] Support contact is live.
- [ ] Logo is available as URL or upload asset.
- [ ] Reviewer account is created.
- [ ] Reviewer account has populated production planning data.
- [ ] MCP tool succeeds with valid OAuth token.
- [ ] MCP tool returns useful bounded response size.
- [ ] MCP tool tested through MCP Inspector.
- [ ] Connector tested in Claude.ai custom connector flow.
- [ ] Tool names are under 64 characters.
- [ ] Tool descriptions are narrow and accurate.
- [ ] Tool descriptions do not contain behavioral prompt instructions.
- [ ] No write/destructive tools are exposed.
- [ ] Submit Remote MCP directory form.

## Approval Risk

Main risks:
- Response is too large or not bounded enough.
- Privacy/support docs are incomplete.
- Reviewer test account is weak or empty.
- Tool description is considered too broad.

Mitigation:
- Keep this submission read-only.
- Provide a fully populated demo account.
- Include exact sample prompts and expected behavior.
