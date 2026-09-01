import sharp from "sharp";
import type { RecordAttachment } from "./storage/records-store.js";

const MAX_ATTACHMENTS = 5;
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 2048;

export interface FileParam {
  download_url: string;
  file_id: string;
  mime_type?: string | undefined;
  file_name?: string | undefined;
}

async function readLimited(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("Each image attachment must be 15 MB or smaller.");
  }
  if (!response.body) throw new Error("The image attachment had no downloadable content.");

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error("Each image attachment must be 15 MB or smaller.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function altText(fileName?: string): string {
  const withoutExtension = fileName?.replace(/\.[^.]+$/, "").trim();
  return withoutExtension ? withoutExtension.slice(0, 80) : "图片";
}

async function normalizeImage(data: Buffer): Promise<{
  data: Buffer;
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}> {
  const image = sharp(data, { limitInputPixels: 40_000_000 }).rotate().resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });
  const metadata = await image.metadata();

  let normalized: Buffer;
  let extension: "jpg" | "png" | "webp";
  let mimeType: "image/jpeg" | "image/png" | "image/webp";
  if (metadata.format === "png") {
    normalized = await image.png({ compressionLevel: 9 }).toBuffer();
    extension = "png";
    mimeType = "image/png";
  } else if (metadata.format === "webp") {
    normalized = await image.webp({ quality: 85 }).toBuffer();
    extension = "webp";
    mimeType = "image/webp";
  } else if (["jpeg", "jpg", "heif", "heic", "avif"].includes(metadata.format ?? "")) {
    normalized = await image.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    extension = "jpg";
    mimeType = "image/jpeg";
  } else {
    throw new Error("Unsupported image format. Use JPEG, PNG, WebP, HEIC, or AVIF.");
  }

  if (normalized.byteLength > MAX_OUTPUT_BYTES) {
    throw new Error("The processed image is still larger than 10 MB.");
  }
  return { data: normalized, extension, mimeType };
}

export async function downloadImageAttachments(
  files: FileParam[],
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<RecordAttachment[]> {
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`A record can include at most ${MAX_ATTACHMENTS} image attachments.`);
  }

  return Promise.all(
    files.map(async (file): Promise<RecordAttachment> => {
      const url = new URL(file.download_url);
      if (url.protocol !== "https:") {
        throw new Error("Image attachment download URLs must use HTTPS.");
      }

      const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) {
        throw new Error(`Could not download image attachment (${response.status}).`);
      }
      const contentType = file.mime_type || response.headers.get("content-type") || "";
      if (contentType && !contentType.toLowerCase().startsWith("image/")) {
        throw new Error("Only image attachments are supported in this version.");
      }

      const normalized = await normalizeImage(await readLimited(response));
      return {
        data: normalized.data,
        extension: normalized.extension,
        mimeType: normalized.mimeType,
        alt: altText(file.file_name),
      };
    }),
  );
}
