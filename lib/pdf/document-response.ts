import { NextResponse } from "next/server";
import { formatAttachmentContentDisposition } from "@/lib/blob-storage";

export type PdfDisposition = "inline" | "attachment";

export function safePdfFilenameSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "document";
}

export function pdfResponse(
  buffer: Buffer,
  filename: string,
  disposition: PdfDisposition,
) {
  const contentDisposition = formatAttachmentContentDisposition(filename);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition":
        disposition === "inline"
          ? contentDisposition.replace(/^attachment/, "inline")
          : contentDisposition,
      "cache-control": "private, no-store",
    },
  });
}
