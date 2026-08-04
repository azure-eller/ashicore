type GeneratedPdfDisposition = "inline" | "attachment";

export async function openGeneratedPdf(
  endpoint: string,
  body: Record<string, unknown>,
  disposition: GeneratedPdfDisposition,
) {
  const previewWindow = disposition === "inline" ? window.open("", "_blank") : null;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, disposition }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Failed to generate PDF.");
    }

    const url = URL.createObjectURL(await response.blob());
    if (previewWindow) {
      previewWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }

    const link = document.createElement("a");
    link.href = url;
    link.download = filenameFromDisposition(response.headers.get("Content-Disposition"));
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    previewWindow?.close();
    throw error;
  }
}

function filenameFromDisposition(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "documents.pdf";
}
