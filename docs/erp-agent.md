---
read_when:
  - Working on agent routes, settings, MCP, or external planning access
  - Re-enabling the in-app ERP agent panel
  - Changing Drizzle schema exports
  - Investigating dashboard cold starts or agent overhead
---

# ERP Agent

The external planning agent surface is active. The in-app dashboard chat panel is
still disabled.

## Current State

- `app/api/agent/mcp/**` exposes the OAuth-backed remote MCP surface.
- `app/api/agent/api-tokens/**` manages bearer tokens for external planning access.
- `app/api/agent/production-planning/context` serves read-only production context.
- `lib/agent/**` owns external access, MCP OAuth, production planning context, and
  replenishment context.
- `app/(dashboard)/settings/agent-access*` owns the settings UI for MCP URLs and
  token management.
- `integrations/claude/ashicore-plugin/` owns the Claude plugin package.
- `lib/feature-flags.ts` keeps `ERP_AGENT_ENABLED = false`; do not render the old
  in-app agent panel while that flag is false.

## Schema Guardrail

`lib/db/schema/index.ts` is the runtime schema barrel and must not export agent
tables unless the in-app agent is active. Runtime dashboard and auth paths import
that barrel, so exporting dormant agent tables there increases ordinary cold-start
work.

`lib/db/schema/migrations.ts` is the Drizzle migration schema barrel and may export
agent tables so existing migrations remain represented.

## Reactivating The In-App Panel

1. Confirm the external MCP/token surfaces still work.
2. Restore the panel behind `ERP_AGENT_ENABLED`.
3. Keep provider-heavy code out of ordinary dashboard imports.
4. Flip `ERP_AGENT_ENABLED` only after the route, UI, and schema import paths are
   verified.
5. Run `pnpm build`, `pnpm lint`, and relevant Playwright coverage.
