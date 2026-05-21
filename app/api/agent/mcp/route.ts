import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { authenticateMcpOAuthAccessToken } from "@/lib/agent/mcp-oauth/service";
import {
  buildAgentProductionPlanningRawJson,
  getAgentProductionPlanningContextForOrg,
} from "@/lib/agent/production-planning-context/service";

export const runtime = "nodejs";

const MCP_RESOURCE_PATH = "/api/agent/mcp";
const MCP_RESOURCE_URL = `${getCanonicalAppUrl()}${MCP_RESOURCE_PATH}`;
const MCP_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource/api/agent/mcp";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_production_planning_context",
      {
        title: "Get Production Planning Context",
        description:
          "Returns compact raw JSON for production planning: open sales orders with shipment buckets, open manufacturing orders, sellable product counts, and product requirements.",
        inputSchema: {
          includeLots: z
            .boolean()
            .optional()
            .describe("Reserved for compatibility. Product counts are item-level."),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (_args, extra) => {
        const orgId = extra.authInfo?.extra?.orgId;

        if (typeof orgId !== "string" || !orgId) {
          return {
            isError: true,
            content: [{ type: "text", text: "Missing organization context." }],
          };
        }

        const context = await getAgentProductionPlanningContextForOrg(orgId, {
          includeLots: false,
          includePlanningFacts: false,
        });
        const rawContext = buildAgentProductionPlanningRawJson(context);

        return {
          structuredContent: rawContext,
          content: [
            {
              type: "text",
              text: JSON.stringify(rawContext),
            },
          ],
        };
      }
    );
  },
  {
    serverInfo: {
      name: "ashicore",
      version: "1.0.0",
    },
  },
  {
    basePath: "/api/agent",
    disableSse: true,
    maxDuration: 60,
  }
);

const authenticatedHandler = withMcpAuth(
  handler,
  async (_request, bearerToken) => {
    const tokenAuth = await authenticateMcpOAuthAccessToken(bearerToken);

    if (!tokenAuth) {
      return undefined;
    }

    return {
      token: bearerToken ?? "",
      clientId: tokenAuth.clientId,
      scopes: tokenAuth.scopes,
      expiresAt: Math.floor(tokenAuth.expiresAt.getTime() / 1000),
      resource: new URL(MCP_RESOURCE_URL),
      extra: {
        orgId: tokenAuth.orgId,
        userId: tokenAuth.userId,
      },
    };
  },
  {
    required: true,
    requiredScopes: ["production_planning:read"],
    resourceMetadataPath: MCP_RESOURCE_METADATA_PATH,
    resourceUrl: getCanonicalAppUrl(),
  }
);

export {
  authenticatedHandler as DELETE,
  authenticatedHandler as GET,
  authenticatedHandler as POST,
};
