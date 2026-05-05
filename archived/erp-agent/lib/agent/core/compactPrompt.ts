export function getCompactionPrompt() {
  return `
CRITICAL: Respond with text only. Do not call any tools.

Summarize the earlier transcript so the agent can continue the onboarding session without losing important context.

Preserve:
- the user's goals and explicit instructions
- important facts learned from uploads or generated artifacts
- mappings already inferred or confirmed
- unresolved ambiguities and pending approvals
- customer/category ids, artifact paths, or tool outputs that still matter
- any safety constraints or write boundaries already established

Return exactly this format:

<summary>
- concise bullet points
- focused on durable context for the next turns
</summary>
  `.trim();
}
