# ChatGPT App Directory Submission

Goal: get Ashicore available as a ChatGPT App users can find in ChatGPT.

Official docs:
- App submission: https://developers.openai.com/apps-sdk/deploy/submission
- App submission guidelines: https://developers.openai.com/apps-sdk/app-submission-guidelines
- UX checklist: https://developers.openai.com/apps-sdk/concepts/ux-principles

## Current Status

Have:
- OpenAPI schema for GPT Actions: `/.well-known/ashicore-agent-production-planning-openapi.json`
- Bearer token auth for GPT Actions
- Read-only production planning endpoint
- Remote MCP server used by Claude

Need:
- A real ChatGPT App built with Apps SDK
- App metadata
- OAuth/auth flow that fits ChatGPT App review
- App UI or response component if needed
- Privacy policy URL
- Support URL or email
- Terms URL if required
- Logo/icon
- Screenshots
- Example prompts
- Reviewer test account and instructions
- Developer Mode testing evidence
- Submission through OpenAI dashboard review flow

## App Concept

Name:
Ashicore

Tagline:
Production planning from your ERP.

Description:
Ashicore lets ChatGPT read production planning data from your ERP so it can help create daily production schedules and identify shipment risks.

Primary user task:
Ask ChatGPT what to make today or this week based on open shipments, current inventory, lot ages, product BOMs, and open manufacturing orders.

Example prompts:
- “What should we make today?”
- “Make a production schedule for this week.”
- “Are we going to miss any shipments?”
- “What would we need to make on which days to avoid shipment misses?”

## Technical Direction

Do not submit the current GPT Action as the final public app.

Build:
- Apps SDK app
- Tool backed by Ashicore production data
- Auth flow for customer ERP access
- Optional simple schedule UI card

Recommended first app tool:
`get_production_schedule`

Why:
The current raw context requires too much reasoning from the model. A schedule-specific tool is easier to review, easier to demo, and more useful for customers.

Minimum tool output:
- daily schedule
- shipment misses
- required avoidance actions by date
- source data references

## Submission Checklist

- [ ] Apps SDK app exists.
- [ ] App tested in Developer Mode.
- [ ] Auth flow works in ChatGPT.
- [ ] Reviewer test account exists.
- [ ] Reviewer account has populated demo ERP data.
- [ ] App has logo/icon.
- [ ] App has privacy policy URL.
- [ ] App has support URL or email.
- [ ] App has submission screenshots.
- [ ] App has example prompts.
- [ ] Tools are narrow and self-contained.
- [ ] Tool responses are bounded.
- [ ] App does not expose sensitive data unnecessarily.
- [ ] Submit through OpenAI dashboard review flow.

## Reviewer Instructions

1. Install/open the Ashicore app in Developer Mode or review environment.
2. Authenticate with the provided reviewer account.
3. Ask: “What should we make each day this week?”
4. Ask: “Are any shipments going to be missed?”
5. Confirm the app returns a schedule and miss/avoidance actions.

## Approval Risk

Main risks:
- ChatGPT App review is stricter than GPT Actions.
- Raw ERP data may be too broad for a clean app experience.
- Lack of an app-specific UI or schedule-specific tool may weaken the submission.

Mitigation:
- Build `get_production_schedule` before submitting.
- Keep app scope to production scheduling.
- Use a simple schedule card or concise structured response.
- Provide a complete reviewer account and demo script.
