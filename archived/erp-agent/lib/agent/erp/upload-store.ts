import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ToolFileStore, type ToolArtifactSummary } from "@/lib/agent/core/Tool";

type StoredBufferArtifact = ToolArtifactSummary & {
  storageKey: string;
};

export interface UploadStore extends ToolFileStore {
  writeBuffer(args: {
    sessionId: string;
    filename: string;
    mediaType: string;
    buffer: Buffer;
    kind?: "raw" | "derived" | "result";
  }): Promise<StoredBufferArtifact>;
  getAbsolutePath(storageKey: string): string;
}

function sanitizeFilename(filename: string) {
  return filename
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120);
}

function guessFileExtension(mediaType: string) {
  switch (mediaType) {
    case "application/json":
      return ".json";
    case "text/plain":
      return ".txt";
    case "text/csv":
      return ".csv";
    default:
      return "";
  }
}

class LocalUploadStore implements UploadStore {
  constructor(private readonly rootDir: string) {}

  private async ensureDirForKey(storageKey: string) {
    await mkdir(path.dirname(this.getAbsolutePath(storageKey)), { recursive: true });
  }

  private buildStorageKey(
    sessionId: string,
    kind: "raw" | "derived" | "result",
    filename: string
  ) {
    const safeFilename = sanitizeFilename(filename) || "artifact";
    return path.posix.join(sessionId, kind, `${randomUUID()}-${safeFilename}`);
  }

  getAbsolutePath(storageKey: string) {
    return path.join(this.rootDir, storageKey);
  }

  async writeBuffer(args: {
    sessionId: string;
    filename: string;
    mediaType: string;
    buffer: Buffer;
    kind?: "raw" | "derived" | "result";
  }): Promise<StoredBufferArtifact> {
    const storageKey = this.buildStorageKey(
      args.sessionId,
      args.kind ?? "raw",
      args.filename
    );
    await this.ensureDirForKey(storageKey);
    await writeFile(this.getAbsolutePath(storageKey), args.buffer);

    return {
      key: storageKey,
      storageKey,
      label: args.filename,
      mediaType: args.mediaType,
      byteSize: args.buffer.byteLength,
    };
  }

  async writeText(args: {
    sessionId: string;
    filename: string;
    mediaType: string;
    content: string;
  }): Promise<ToolArtifactSummary> {
    const result = await this.writeBuffer({
      sessionId: args.sessionId,
      filename: args.filename,
      mediaType: args.mediaType,
      buffer: Buffer.from(args.content, "utf8"),
      kind: "result",
    });

    return result;
  }

  async writeJson(args: {
    sessionId: string;
    filename: string;
    mediaType?: string;
    data: unknown;
  }): Promise<ToolArtifactSummary> {
    return this.writeText({
      sessionId: args.sessionId,
      filename:
        path.extname(args.filename).length > 0
          ? args.filename
          : `${args.filename}${guessFileExtension("application/json")}`,
      mediaType: args.mediaType ?? "application/json",
      content: JSON.stringify(args.data, null, 2),
    });
  }

  async readBuffer(storageKey: string) {
    return readFile(this.getAbsolutePath(storageKey));
  }

  async readText(storageKey: string) {
    return readFile(this.getAbsolutePath(storageKey), "utf8");
  }

  async getByteSize(storageKey: string) {
    const file = await stat(this.getAbsolutePath(storageKey));
    return file.size;
  }
}

let cachedStore: UploadStore | null = null;

export function getUploadStore() {
  if (cachedStore) {
    return cachedStore;
  }

  const rootDir =
    process.env.AGENT_UPLOAD_STORE_ROOT ?? path.join(process.cwd(), ".agent-uploads");
  cachedStore = new LocalUploadStore(rootDir);
  return cachedStore;
}
