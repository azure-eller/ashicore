---
read_when:
  - Re-enabling the ERP agent
  - Working on agent code
  - Changing Drizzle schema exports
  - Investigating dashboard cold starts or agent overhead
---

# ERP Agent

The ERP agent is intentionally disabled for now. The code, database schema, and
migration history are kept so the feature can be restored later, but disabled
dashboard routes should not load agent UI, agent services, Anthropic code, or
agent Drizzle tables.

## Current Parked State

- `lib/feature-flags.ts` exports `ERP_AGENT_ENABLED = false`.
- `app/(dashboard)/layout.tsx` only enables the sidebar agent when the feature
  flag is true and the member has agent access.
- `components/app-sidebar.tsx` dynamically imports `AgentChatPanel`, so normal
  dashboard bundles do not include the chat panel while the flag is false.
- `app/api/agent/**` returns `404` before importing session, tool, upload, or
  provider code.
- `lib/db/schema/index.ts` is the runtime schema barrel and must not export
  `./agent` while the feature is parked.
- `lib/db/schema/migrations.ts` is the Drizzle migration schema barrel and does
  export `./agent`, so existing tables stay represented in migrations.

## Reactivation Checklist

1. Flip `ERP_AGENT_ENABLED` to `true` in `lib/feature-flags.ts`.
2. Keep `AgentChatPanel` dynamically imported from `components/app-sidebar.tsx`.
3. Confirm `drizzle.config.ts` still points at `lib/db/schema/migrations.ts`.
4. Keep agent service code importing agent tables from `@/lib/db/schema/agent`.
5. Re-enable or remove the disabled-state Playwright skip logic as appropriate.
6. Run `pnpm build`, `pnpm lint`, and `pnpm test`.
7. For live provider coverage, run `pnpm test:e2e:agent:live` with
   `LIVE_AGENT_SMOKE=1` and `ANTHROPIC_API_KEY`.

## Cold-Start Guardrails

Do not add `export * from "./agent"` back to `lib/db/schema/index.ts` unless the
agent is fully active again. That barrel is imported by the runtime DB and auth
paths, so exporting agent tables there makes ordinary dashboard and API cold
starts evaluate the agent schema.
