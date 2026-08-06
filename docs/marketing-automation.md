---
read_when:
  - Configuring or operating autonomous marketing experiments
  - Changing Gmail outreach, contact suppression, or marketing cron behavior
  - Editing the founder cold-email corpus
---

# Autonomous Marketing

This is a backend-only experiment runner. It uses researched customer contacts
and customer activities already stored in the Ashicore organization. It does
not discover companies, expose a dashboard, choose a market, or conduct an
interested sales conversation.

Each hourly invocation starts with fresh process and model context, reads the
active experiment from Postgres, performs a bounded unit of work, records the
result, and exits. Postgres is the durable orchestrator.

## Safety Envelope

- One active experiment per organization.
- An experiment contains 1–30 explicit CRM contact IDs.
- The first three sends are canaries, with no further sends on the local day
  the third canary is sent. Later weekdays send at most five total messages
  between 08:00 and 10:00 organization-local time.
- Each recipient can receive one initial message and one follow-up after five
  days.
- Generation and evaluation use separate fresh model calls. One rewrite is
  permitted; a second failure skips the contact.
- Gmail sends use a stable RFC message ID and search Gmail before retrying.
- Opt-outs and complaints suppress the CRM contact automatically.
- Complaints, two bounces among the first ten sends, or Gmail delivery/sync
  failures pause the experiment.
- Positive and unknown replies are sent to the configured founder alert email.
- Interested conversations are never answered automatically.

## Required Configuration

Set these on the authenticated `erp` Vercel project, not the public `www`
project:

```text
MARKETING_AUTOMATION_ORG_ID
MARKETING_SENDER_NAME
MARKETING_POSTAL_ADDRESS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://ashicore.app/api/marketing/gmail/callback
GOOGLE_TOKEN_ENCRYPTION_KEYS={"gmail_v1":"<32-byte-base64-key>"}
GOOGLE_TOKEN_ENCRYPTION_KEY_ID=gmail_v1
OPENAI_API_KEY
ASHICORE_ALERT_EMAILS
```

Configure either `MARKETING_AUTOMATION_SECRET` or the shared `CRON_SECRET` for
the marketing route. `ASHICORE_ALERT_EMAILS` is required for positive/unknown
reply, pause, and completion notices to reach the founder.
`MARKETING_AGENT_MODEL` may override the shared agent model. Configure the
Google OAuth consent screen for `gmail.send` and `gmail.readonly`, then register
the exact redirect URI above.

## Founder Corpus

Edit `lib/marketing/email-corpus.json`. Activation fails closed until it holds
at least five examples. Keep the set small and canonical; each item needs an
ID, situation, subject, and body. The optional blacklist is for a short list of
recurring phrases that should always fail style evaluation.

The model receives CRM evidence, the experiment's one pain angle and CTA, and
the corpus. It may not introduce product claims outside `allowedClaims`.

## Owner API

All `/api/marketing/*` routes require an authenticated organization owner and
are restricted to `MARKETING_AUTOMATION_ORG_ID` in production.

```text
GET    /api/marketing/experiments
POST   /api/marketing/experiments
GET    /api/marketing/experiments/:id
POST   /api/marketing/experiments/:id/activate
POST   /api/marketing/experiments/:id/pause
GET    /api/marketing/gmail/connect
GET    /api/marketing/gmail/callback
DELETE /api/marketing/gmail
PATCH  /api/marketing/contacts/:id/suppression
```

Create payload:

```json
{
  "hypothesis": "Operators will discuss spreadsheet-based production planning.",
  "segment": "Researched soil manufacturers",
  "painAngle": "Recipe inputs and raw-material availability",
  "cta": "Ask how they handle it today",
  "allowedClaims": [
    "Ashicore is operations software for smaller batch manufacturers."
  ],
  "contactIds": ["<crm-contact-uuid>"]
}
```

Suppression payloads are `{ "suppressed": true, "reason": "manual" }` and
`{ "suppressed": false }`. Clearing suppression is deliberately an owner-only
manual action.

## Measurement

The source of truth is the experiment row plus CRM email activities. Activity
metadata records supplied evidence, generated and final copy, evaluator
verdicts, model/prompt/corpus versions, Gmail IDs, and reply outcome.

The completion report records sent, delivered, bounced, positive replies,
valid-delivery rate, and qualified-positive-reply rate. It stores one bounded
learning and proposes one changed variable; it never launches the next
experiment. Opens are not a reward signal.
