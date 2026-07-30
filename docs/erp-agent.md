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

## Shared Task Core

The revived agent starts as task-owned primitives, not a global sidebar
assistant. Entry points define their own task, prompt sections, and tools. That
keeps onboarding import limited to uploaded documents, while later entry points
such as replenishment can opt into planning or inventory context without bloating
every run.

Active shared primitives live in `lib/agent/core/`:

- `defineAgentTask` scopes a run to one task id, purpose, prompt stack, and tool
  list.
- `buildAgentTool` wraps deterministic input/output validation, execution, result
  summaries, and optional artifact persistence.
- `runAgentTask` provides the dormant runtime loop, modelled on Codex's
  turn/`ResponseEvent` pipeline: it consumes the provider's streamed model turn,
  forwards text/reasoning deltas live, dispatches tool calls (concurrency-safe
  ones launch together, the rest run sequentially, results keep model order),
  feeds results back, runs optional deterministic final-output validation, and
  emits run/turn/tool/validation/completion events. A linked abort controller
  cancels the in-flight provider stream when the run ends or the consumer drops.
- Prompt sections support static, task, org, and run tiers with cache invalidation
  for non-run sections.
- `lib/onboarding/import/extraction/agent-contract.ts` owns the current
  onboarding import contract, model-output schema, correction prompt, and dormant
  onboarding import task definition. The legacy extractor imports this contract
  so runtime migration does not fork prompt behavior.
- `lib/onboarding/import/extraction/agent-tools.ts` owns task-scoped onboarding
  upload tools: list files and read text/workbook content. Workbook reads reuse
  the existing structured reader so formulas, comments, hidden-sheet state, and
  inventory signal indexes are visible to the agent without adding global ERP
  context.

Provider-specific adapters live outside the core:

- `lib/agent/providers/openai-responses.ts` creates the server-only OpenAI
  Responses provider.
- `lib/agent/providers/openai-responses-adapter.ts` owns the pure transcript,
  tool schema, and tool-call translation, and implements `streamTurn` over the
  Responses streaming API: it maps SDK stream events to provider-neutral
  `AgentStreamEvent`s and forwards `output_schema`/`parallel_tool_calls` from the
  request (mirroring Codex's `Prompt`). Keep SDK/API details here instead of
  leaking them into task definitions or `lib/agent/core`. The model-turn boundary
  (`AgentModelProvider.streamTurn`) is streaming-native, so a second provider
  (for example Anthropic) only has to map its own stream to the same events.

Do not move archived UI, broad ERP read tools, write tools, or provider-specific
streaming code back into active paths until a concrete entry point needs them.
The first production use should wire a narrow task, for example onboarding
document import, to these primitives. Provider adapters and document-reader tools
should remain task-owned and should not become default context for unrelated
entry points.

## Current State

- `app/api/agent/mcp/**` exposes the OAuth-backed remote MCP surface.
- `app/api/agent/api-tokens/**` manages bearer tokens for external planning access.
- `app/api/agent/production-planning/context` serves read-only production context
  with canonical item display names, including assigned variant option labels.
- `lib/agent/**` owns external access, MCP OAuth, production planning context, and
  replenishment context; replenishment item names use the same canonical
  identity.
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
2. Wire one narrow entry point to `lib/agent/core/`.
3. Restore the panel behind `ERP_AGENT_ENABLED` only if the entry point needs it.
4. Keep provider-heavy code out of ordinary dashboard imports.
5. Flip `ERP_AGENT_ENABLED` only after the route, UI, and schema import paths are
   verified.
6. Run `pnpm build`, `pnpm lint`, and relevant Playwright coverage.
