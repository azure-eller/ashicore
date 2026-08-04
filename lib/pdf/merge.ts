import { PDFDocument } from "pdf-lib";

export async function mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();

  for (const buffer of buffers) {
    const source = await PDFDocument.load(buffer);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  return Buffer.from(await merged.save());
}
