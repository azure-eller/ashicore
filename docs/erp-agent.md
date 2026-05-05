---
read_when:
  - Re-enabling the ERP agent
  - Working on agent code
  - Changing Drizzle schema exports
  - Investigating dashboard cold starts or agent overhead
---

# ERP Agent

The ERP agent is intentionally disabled and archived for now. Database schema
and migration history are kept so the feature can be restored later, but normal
dashboard routes must not load agent UI, agent services, Anthropic code, or
agent Drizzle tables.

## Current Parked State

- `lib/feature-flags.ts` exports `ERP_AGENT_ENABLED = false`.
- Parked implementation code lives under `archived/erp-agent/`, which is
  excluded from TypeScript and ESLint.
- `components/app-sidebar.tsx` does not import or render the agent panel.
- `app/api/agent/**` is a JSON `404` catch-all and imports no archived code.
- `@anthropic-ai/sdk` is not installed while the feature is archived.
- `lib/db/schema/index.ts` is the runtime schema barrel and must not export
  `./agent` while the feature is parked.
- `lib/db/schema/migrations.ts` is the Drizzle migration schema barrel and does
  export `./agent`, so existing tables stay represented in migrations.

## Reactivation Checklist

1. Move needed code from `archived/erp-agent/` back into active app paths.
2. Reinstall the provider dependency: `pnpm add @anthropic-ai/sdk`.
3. Restore a dynamically imported `AgentChatPanel` in `components/app-sidebar.tsx`.
4. Restore agent API routes and keep them gated by `ERP_AGENT_ENABLED`.
5. Flip `ERP_AGENT_ENABLED` to `true` in `lib/feature-flags.ts`.
6. Confirm `drizzle.config.ts` still points at `lib/db/schema/migrations.ts`.
7. Keep agent service code importing agent tables from `@/lib/db/schema/agent`.
8. Restore agent Playwright specs/scripts as needed.
9. Run `pnpm build`, `pnpm lint`, and `pnpm test`.

## Cold-Start Guardrails

Do not add `export * from "./agent"` back to `lib/db/schema/index.ts` unless the
agent is fully active again. That barrel is imported by the runtime DB and auth
paths, so exporting agent tables there makes ordinary dashboard and API cold
starts evaluate the agent schema.
