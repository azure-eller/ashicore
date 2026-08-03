# Docs index

`CLAUDE.md` (repo root) is the constitution and the curated hot-path map — read it
first. This file is the complete index: every doc lives here so nothing is
invisible. Read the relevant doc before working in its area.

## Architecture & data
- [architecture.md](./architecture.md) — module map, layers, data flow, where logic belongs
- [database.md](./database.md) — schema, migrations, DAL, RLS, roles, guarded production data access
- [api-patterns.md](./api-patterns.md) — API routes, mutations, handlers, query keys
- [card-kernel.md](./card-kernel.md) — card pages, draft/auto-save lifecycle, bound fields
- [item-card-backend-contract.md](./item-card-backend-contract.md) — item card API routes & response fields
- [erp-agent.md](./erp-agent.md) — ERP agent runtime, tools, reactivation, overhead

## Domain modules
- [sales.md](./sales.md) — sales orders, customers, shipping
- [purchasing.md](./purchasing.md) — suppliers, purchase orders, receiving, landed cost
- [manufacturing.md](./manufacturing.md) — manufacturing orders, BOMs, execution, costing
- [stocktakes.md](./stocktakes.md) — stocktakes, reconciliation
- [notifications.md](./notifications.md) — notifications, push, FCM
- [auth-team.md](./auth-team.md) — auth, roles, module guards, team invites
- [billing.md](./billing.md) — Free/Pro plans, SKU capacity, Stripe projection, beta access
- [planning.md](./planning.md) — MRP-lite planning service (**dormant — no UI surface**)

## Design & UI
- [design/README.md](./design/README.md) — design-docs map and anti-drift rules
- [design/foundations.md](./design/foundations.md) — design intent + token source-of-truth rule
- [design/components.md](./design/components.md) — reusable UI primitives and when to use them
- [design/decisions/](./design/decisions/) — design ADRs (append-only)
- [ui-patterns.md](./ui-patterns.md) — composition patterns: forms, tables, cards, dialogs, status, icons, loading
- [ui-review-checklist.md](./ui-review-checklist.md) — UI screenshot review rubric
- [inventory-visuals.md](./inventory-visuals.md) — inventory status/stock visual components
- [operator-docs-authoring-guide.md](./operator-docs-authoring-guide.md) — authoring operator docs (`apps/www`, `/docs`): Starlight hub-and-spoke, the inline doc UI kit, public/private altitude split

## Forms
- [references/field-example.md](./references/field-example.md) — the `Field` building blocks
- [references/react-hook-form-example.md](./references/react-hook-form-example.md) — useForm + Controller + Zod, submitting via a mutation

## Testing & workflow
- [testing.md](./testing.md) — test lanes, CI labels, fixtures, guardrails
- [worktrees.md](./worktrees.md) — worktrees, multi-agent safety, cleanup
- [linear-workflow.md](./linear-workflow.md) — Linear/GitHub PR tracking

## Integrations & ops
- [xero.md](./xero.md) — Xero integration, OAuth, push retry
- [xero-partner-readiness.md](./xero-partner-readiness.md) — Xero App Store / partner readiness
- [xero-security-evidence.md](./xero-security-evidence.md) — Xero security evidence / key rotation
- [xero-support-listing.md](./xero-support-listing.md) — Xero support listing content
- [production-ops.md](./production-ops.md) — production launch, agent CLI access, auth protection, observability
- [paonia-current-seed.md](./paonia-current-seed.md) — refreshing Paonia seed data from production

## Observability
- [observability/sentry-triage.md](./observability/sentry-triage.md) — Sentry triage workflow
- [observability/sentry-autofix.md](./observability/sentry-autofix.md) — Sentry autofix PR packets + sanitizer
- [observability/sentry-vocabulary.md](./observability/sentry-vocabulary.md) — canonical Sentry tag/context vocabulary

## Archive
- [archive/](./archive/) — frozen historical docs; not current reference
