import { get, type GetBlobResult } from "@vercel/blob";

type PrivateBlobRead = Extract<GetBlobResult, { statusCode: 200 }>;

const PRIVATE_BLOB_READ_ATTEMPTS = 3;
const PRIVATE_BLOB_READ_RETRY_MS = 250;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getPrivateBlobForDownload(
  urlOrPathname: string
): Promise<PrivateBlobRead | null> {
  for (let attempt = 1; attempt <= PRIVATE_BLOB_READ_ATTEMPTS; attempt += 1) {
    const blob = await get(urlOrPathname, {
      access: "private",
      useCache: false,
    });

    if (blob?.statusCode === 200 && blob.stream) {
      return blob;
    }

    if (attempt < PRIVATE_BLOB_READ_ATTEMPTS) {
      await wait(PRIVATE_BLOB_READ_RETRY_MS);
    }
  }

  return null;
}
