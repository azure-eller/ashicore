import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { env } from "@/lib/env";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { authenticateMcpOAuthAccessToken } from "@/lib/agent/mcp-oauth/service";
import {
  buildAgentProductionPlanningRawJson,
  getAgentProductionPlanningContextForOrg,
} from "@/lib/agent/production-planning-context/service";
import { getAgentReplenishmentContextForOrg } from "@/lib/agent/replenishment-context/service";

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
          "Returns compact raw JSON for production planning: open sales demand, open manufacturing orders, sellable product counts with lots, and product BOM requirements.",
        inputSchema: {
          includeLots: z
            .boolean()
            .optional()
            .describe("Include product lot counts with received dates. Defaults to true."),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        const orgId = extra.authInfo?.extra?.orgId;

        if (typeof orgId !== "string" || !orgId) {
          return {
            isError: true,
            content: [{ type: "text", text: "Missing organization context." }],
          };
        }

        const context = await getAgentProductionPlanningContextForOrg(orgId, {
          includeLots: args.includeLots ?? true,
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
    server.registerTool(
      "get_replenishment_context",
      {
        title: "Get Replenishment Context",
        description:
          "Returns neutral purchased-material replenishment facts. Use summary first, then detail for one item. Does not include safety stock, risk labels, or write actions.",
        inputSchema: {
          view: z
            .enum(["summary", "detail"])
            .optional()
            .describe("summary returns compact rows; detail returns richer facts for one item. Defaults to summary."),
          item: z
            .string()
            .optional()
            .describe("Item name, SKU, or item id. Required for detail view."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Maximum summary rows to return. Defaults to 100."),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        const orgId = extra.authInfo?.extra?.orgId;

        if (typeof orgId !== "string" || !orgId) {
          return {
            isError: true,
            content: [{ type: "text", text: "Missing organization context." }],
          };
        }

        try {
          const context = await getAgentReplenishmentContextForOrg(orgId, {
            view: args.view,
            item: args.item,
            limit: args.limit,
          });

          return {
            structuredContent: context,
            content: [
              {
                type: "text",
                text: JSON.stringify(context),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : "Failed to load replenishment context.",
              },
            ],
          };
        }
      }
    );

    server.registerTool(
      "get_deployment",
      {
        title: "Get Deployment",
        description:
          "Returns the git commit sha and Vercel environment the responding server was built from. Use it to confirm a merge is live in production: the returned commitSha equals, or descends from, the merge commit.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        const deployment = {
          commitSha: env.VERCEL_GIT_COMMIT_SHA ?? null,
          environment: env.VERCEL_ENV ?? null,
          deploymentId: env.VERCEL_DEPLOYMENT_ID ?? null,
          checkedAt: new Date().toISOString(),
        };

        return {
          structuredContent: deployment,
          content: [{ type: "text", text: JSON.stringify(deployment) }],
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
