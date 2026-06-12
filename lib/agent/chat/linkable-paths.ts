// Grid pages the assistant may link as [label](/path?q=term). The chat prompt
// quotes this list and the chat UI refuses to linkify any other path, so the
// constraint holds even against a misbehaving model turn.
export const AGENT_LINKABLE_PATHS = [
  "/inventory/products",
  "/inventory/materials",
  "/inventory/stocktakes",
  "/sales/orders",
  "/sales/customers",
  "/purchasing/orders",
  "/purchasing/suppliers",
  "/manufacturing/orders",
] as const;
