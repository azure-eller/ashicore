---
read_when:
  - updating Xero App Store listing or support copy
  - changing Sign up with Xero, Xero connect, or Xero disconnect workflows
  - answering customer-facing Xero onboarding questions
---

# Xero support and listing notes

## Sign up with Xero

Use `/api/xero/sign-up` as the Xero App Store signup URL. It starts Xero OAuth
with identity and accounting scopes, then returns to Ashicore through
`/api/xero/callback`.

New customers are created as passwordless Ashicore users from the Xero identity.
Ashicore creates one owner organization from the connected Xero tenant, activates
that organization, connects Xero, and lands the customer in settings.

Existing Ashicore users with the same email must sign in before linking the Xero
signup intent to their active organization. Ashicore does not show a Sign in
with Xero button on the normal sign-in page.

## Normal Xero connect

Existing customers connect or reconnect Xero from Settings > Integrations. That
flow uses `/api/xero/connect`, requires an authenticated active organization,
and preserves the previously selected tenant on reconnect when Xero authorizes
multiple tenants.

## Duplicate handling

One Xero tenant maps to one Ashicore organization. If the tenant is already
connected to the active organization, reconnect updates the stored tokens. If
the tenant belongs to another Ashicore organization, signup/linking is blocked
and support should verify ownership before making changes.

If an Ashicore organization is already connected to a different Xero tenant,
the customer must disconnect or reconnect from Settings > Integrations before
using the App Store signup flow.

## Disconnect

Customers disconnect Xero from Settings > Integrations. Disconnect removes the
stored OAuth connection and stops imports, sales invoice pushes, supplier bill
pushes, and retry jobs for that organization. Existing ERP records and
accounting sync history remain in Ashicore.

## Data flow

Ashicore stores encrypted Xero access and refresh tokens, the selected tenant,
the authorized tenant list, and sync metadata. Imports can read customers,
suppliers, purchased items, and open purchase orders. Exports can create sales
invoices and supplier bills. ERP purchase orders, purchase order PDFs, supplier
emails, receiving, lots, and landed inventory cost remain in Ashicore.
