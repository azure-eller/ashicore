---
read_when:
  - Working on auth, roles, team management, or invites
  - Adding a new dashboard module or API route
  - Changing sidebar visibility or route access rules
---

# Auth, Roles, and Team

## Source of Truth

- Better Auth `system.member.role` is the canonical member access store.
- Better Auth `system.invitation` is the canonical pending-invite store.
- Do not add custom role tables or custom invitation tables for v1.

## Access Model

- `owner` is the only special top-level role
- Module access is a matrix stored in Better Auth role arrays:
  - modules: `inventory`, `sales`, `manufacturing`, `purchasing`, `settings`
  - levels: `none`, `read`, `operate`, `admin`
- Assigned roles are atomic strings such as `sales:operate`, `inventory:admin`
- `access:matrix` marks rows that use the matrix model
- `owner` bypasses module checks
- Non-owner users are exposed as `User` in the team UI and get only the module access explicitly assigned in the matrix
- `settings:admin` can invite users, edit non-owner user permissions, remove non-owner users, and grant `settings:admin` to other non-owner users
- `inventory:operate` covers normal item master create/edit plus stock workflows
- `inventory:admin` is reserved for higher-risk inventory controls such as destructive item actions
- Unlocked product BOMs use `inventory:operate`
- Locked BOMs are flagged on the product item row and require `inventory:admin` to lock, unlock, or edit
- Manufacturing admin may view locked BOMs in inventory detail views, but manufacturing execution is not blocked by BOM lock
- Personal account settings are available to all authenticated members
- Team management is governed by `owner` or `settings:admin`

## Guard Pattern

Use one shared authz layer from `lib/authz.ts` and `lib/dal/auth.ts`.

- Dashboard/module read access: guard in layouts and write-only pages
- API read access: guard in GET handlers
- API write access: guard before parsing or mutating

```ts
await requireModuleAccess("purchasing", "read")
await requireModuleAccess("sales", "operate")
await assertModuleAccess("inventory", "read", request.headers)
await assertModuleAccess("manufacturing", "operate", request.headers)
```

This keeps nav visibility, page access, and API enforcement aligned.

Do not wrap request-auth helpers that read `headers()` in React `cache()`. Member context must stay request-scoped so one user’s role/org never bleeds into another request.

## Auth Hosts

- Keep `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` as the canonical app URL for emails and non-request fallbacks.
- `lib/auth.ts` resolves Better Auth URLs from the incoming request when the host is allowed.
- `localhost`, `127.0.0.1`, and `[::1]` are allowed on any port for local worktrees.
- Vercel preview deploys may fall back to `VERCEL_BRANCH_URL` or `VERCEL_URL` when the canonical URL env vars are missing.
- Vercel preview deploys auto-allow `*.vercel.app`; add explicit patterns only for non-Vercel preview hosts.
- Production Vercel aliases that can serve app pages must be included in `BETTER_AUTH_ALLOWED_HOSTS`.
- Production page loads on non-canonical hosts redirect to the canonical app URL before auth checks.
- Add LAN IPs or tunnel hosts through `BETTER_AUTH_ALLOWED_HOSTS` as comma-separated host patterns.
- Do not rewrite `BETTER_AUTH_URL` just because a worktree is running on `:3001` or another local port.

## Team Module Pattern

- Team UI lives under `Settings > Team`
- Owner or `settings:admin` access only
- Team invites require a preset: `admin`, `ops_manager`, `sales_manager`, `sales_operator`, or `view_only`
- Presets are templates over the matrix, not a separate auth system
- Team UI should show the derived preset first and only open the matrix in a per-member customize surface
- Any matrix that no longer matches a preset should display as `Custom`
- Team reads come from repo-native DAL in `app/(dashboard)/settings/queries.ts`
- Team mutations go through `app/api/team/*`
- Dashboard Team UI does not call Better Auth directly
- Team mutation routes may call Better Auth server APIs after repo-native permission checks

## Invite Flow

- Invite emails are sent through the Better Auth organization plugin `sendInvitationEmail`
- `POST /api/team/invitations` should send `{ email, presetKey }`
- Invite and member rows should derive their preset label from the stored matrix tokens
- Use the app invite page at `/accept-invitation?id=<invitationId>`
- New invited users create an account and join the org in one submit
- There is no separate visible accept-invitation confirmation step
- Existing accounts should sign in to their existing workspace; invite-page sign-in does not join another org
- Public sign-up remains for first-time org owners creating a new org
- `/org-setup` remains the fallback resolver for owner onboarding and no-active-org recovery

## Resend Wrapper

Better Auth resends by calling `createInvitation` again with `resend: true`.

```ts
await auth.api.createInvitation({
  headers: request.headers,
  body: { email, role, resend: true },
  asResponse: true,
})
```

## New Module Checklist

When adding a new dashboard module:

1. Add its access rules in `lib/authz.ts`
2. Guard the module layout with `requireModuleAccess(..., "read")`
3. Guard create/edit pages with `requireModuleAccess(..., "operate")` or `"admin"`
4. Guard API GET routes with `assertModuleAccess(..., "read", ...)`
5. Guard API mutations with `assertModuleAccess(..., "operate" | "admin", ...)`
6. Update sidebar visibility from the same authz helpers
