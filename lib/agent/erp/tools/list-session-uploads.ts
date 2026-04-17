import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";

export const listSessionUploadsTool = buildTool({
  name: "ListSessionUploads",
  description: "Return the current upload manifest for this onboarding session.",
  inputSchema: z.strictObject({}),
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(_input, ctx) {
    return ctx.uploads.map((upload) => ({
      id: upload.id,
      absolutePath: upload.absolutePath,
      filename: upload.sourceFilename,
      mediaType: upload.mediaType,
      normalizedKind: upload.normalizedKind,
      manifest: upload.manifest,
    }));
  },
});
