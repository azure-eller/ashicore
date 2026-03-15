## Project
ERP system — clean rebuild. Inventory module first.
Old repo for reference: `/home/aeller/Projects/soil-erp`

## Stack
Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui, TanStack Query, react-hook-form, Zod, Better Auth, pnpm

## Commands
- `pnpm dev` — start dev server
- `pnpm build` — production build (catch type errors)
- `pnpm lint` — ESLint
- `pnpm drizzle-kit generate` — generate migration from schema changes
- `pnpm drizzle-kit migrate` — apply migrations

## Context Docs
Read the relevant doc before working in that area:

| Task area | Read |
|-----------|------|
| Forms / form fields | `docs/references/field-example.md`, `docs/references/react-hook-form-example.md` |
| UI, components, layout | `docs/ui-patterns.md` |
| API routes, mutations | `docs/api-patterns.md` |
| Schema, migrations, DAL | `docs/database.md` |
| Feature planning | `docs/architecture.md` |

## Critical Rules
- No hardcoded Tailwind colors — shadcn semantic tokens only
- API routes for all mutations — no server actions
- NEVER import db directly in pages, components, or API routes — use DAL
- NEVER use `drizzle push` — always `generate` + `migrate`
- Icons: HugeIcons only (`@hugeicons/core` / `@hugeicons/react`) — never Lucide
- shadcn/ui style: `radix-nova` with `stone` base color. Check `components.json` for aliases.
- Run `pnpm build` after changes to catch type errors

## Workflow
Use git worktrees for all feature work. Worktree directory: `.worktrees/`

After exiting plan mode and before making any changes:
1. Create a worktree: `git worktree add .worktrees/<branch-name> -b <branch-name>`
2. Work inside the worktree: `cd .worktrees/<branch-name>` and run `pnpm install`
3. Implement the changes and commit them
4. Push the branch: `git push -u origin <branch-name>`
5. Create a PR to merge back into main on GitHub
6. After merge, clean up: `git worktree remove .worktrees/<branch-name>`
