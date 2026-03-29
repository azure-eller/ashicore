---
read_when:
  - Working on auth, roles, team management, or invites
  - Adding a new dashboard module or API route
  - Changing sidebar visibility or route access rules
---

# Auth, Roles, and Team

## Source of Truth

- Better Auth `system.member.role` is the canonical org role.
- Better Auth `system.invitation` is the canonical pending-invite store.
- Do not add custom role tables or custom invitation tables for v1.

## Fixed Roles

- `owner`: full app access, full team management
- `admin`: full app access, can manage `operator` and `viewer`, cannot invite/change/remove `admin` or `owner`
- `operator`: read/write `inventory` and `manufacturing`
- `viewer`: read-only `inventory`, `sales`, `manufacturing`, and `purchasing`
- Legacy Better Auth `member` must be normalized to viewer-style access in app authz helpers

## Guard Pattern

Use one shared authz layer from `lib/authz.ts` and `lib/dal/auth.ts`.

- Dashboard/module read access: guard in layouts and write-only pages
- API read access: guard in GET handlers
- API write access: guard before parsing or mutating

```ts
await requireModuleReadAccess("purchasing")
await requireModuleWriteAccess("sales")
await assertModuleReadAccess("inventory", request.headers)
await assertModuleWriteAccess("manufacturing", request.headers)
```

This keeps nav visibility, page access, and API enforcement aligned.

Do not wrap request-auth helpers that read `headers()` in React `cache()`. Member context must stay request-scoped so one user’s role/org never bleeds into another request.

## Auth Hosts

- Keep `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` as the canonical app URL for emails and non-request fallbacks.
- `lib/auth.ts` resolves Better Auth URLs from the incoming request when the host is allowed.
- `localhost`, `127.0.0.1`, and `[::1]` are allowed on any port for local worktrees.
- Add LAN IPs or tunnel hosts through `BETTER_AUTH_ALLOWED_HOSTS` as comma-separated host patterns.
- Do not rewrite `BETTER_AUTH_URL` just because a worktree is running on `:3001` or another local port.

## Team Module Pattern

- Team UI lives under `Settings > Team`
- Owner/admin access only
- Team reads come from repo-native DAL in `app/(dashboard)/settings/queries.ts`
- Team mutations go through `app/api/team/*`
- Dashboard Team UI does not call Better Auth directly
- Team mutation routes may call Better Auth server APIs after repo-native permission checks

## Invite Flow

- Invite emails are sent through the Better Auth organization plugin `sendInvitationEmail`
- Use the app invite page at `/accept-invitation?id=<invitationId>`
- Invite acceptance must support:
  - existing matching-email user signs in and accepts
  - new user creates account from invite and accepts
- Public sign-up remains for first-time org owners creating a new org
- Later sign-ins for invited members may not have an active org on the new session. Treat `/org-setup` as the fallback resolver:
  - `0` orgs: show create-organization form
  - `1` org: auto-activate it, then redirect into the app
  - `>1` orgs: let the user choose which org to activate

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

1. Add its read/write rules in `lib/authz.ts`
2. Guard the module layout with `requireModuleReadAccess(...)`
3. Guard create/edit pages with `requireModuleWriteAccess(...)`
4. Guard API GET routes with `assertModuleReadAccess(...)`
5. Guard API mutations with `assertModuleWriteAccess(...)`
6. Update sidebar visibility from the same authz helpers
