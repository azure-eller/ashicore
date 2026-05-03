---
read_when:
  - continuing ERP-24 aggressive pre-customer cleanup
---

# ERP-24 Cleanup Baseline

Date: 2026-05-03
Worktree: `/home/aeller/Projects/erp-erp-24`
Branch: `azureller1/erp-24-aggressive-pre-customer-erp-cleanup`

## Commands

- `pnpm install --frozen-lockfile`: passed. Fresh worktree had no `node_modules`.
- `pnpm db:local:setup`: passed. Created worktree-local `.env.local` and local DB.
- `pnpm build`: passed after local DB setup.
- `pnpm lint`: passed after dependency install.
- `pnpm test:sales`: did not reach specs; failed because no dev server was running at `http://localhost:3000`.
- `pnpm test:inventory`: did not reach specs; failed because no dev server was running at `http://localhost:3000`.

## Usage Inventory

Search scope: `app components lib scripts test package.json pnpm-lock.yaml docs`

- Agent/runtime/dependency search:
  - Patterns: `@/lib/agent`, `lib/agent`, `@/components/agent`, `components/agent`, `@anthropic-ai/sdk`, `/api/agent`
  - Matches before cleanup: 179
- `SoStageAction` list-row shipping/accounting search:
  - Patterns: `canShip`, `shipMutation`, `shipConfirmOpen`, `AccountingSync`, `AccountingAction`, `onlineInvoice`, `xero-online-invoice`, `syncDialog`, `shipOptions`, `Ship Sales Order`, `Shipping Sales Order`
  - Matches before cleanup: 39
