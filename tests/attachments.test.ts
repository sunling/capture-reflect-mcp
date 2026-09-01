import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { downloadImageAttachments } from "../src/attachments.js";

describe("downloadImageAttachments", () => {
  it("downloads, resizes, and normalizes an uploaded photo", async () => {
    const original = await sharp({
      create: {
        width: 3000,
        height: 1000,
        channels: 3,
        background: "#8a9b7c",
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const fetchImpl: typeof globalThis.fetch = async () =>
      new Response(new Uint8Array(original), {
        headers: {
          "content-length": String(original.byteLength),
          "content-type": "image/jpeg",
        },
      });

    const [attachment] = await downloadImageAttachments(
      [
        {
          download_url: "https://files.example.test/photo",
          file_id: "file_123",
          mime_type: "image/jpeg",
          file_name: "遛猫照片.jpeg",
        },
      ],
      fetchImpl,
    );

    const metadata = await sharp(attachment!.data).metadata();
    expect(attachment?.extension).toBe("jpg");
    expect(attachment?.mimeType).toBe("image/jpeg");
    expect(attachment?.alt).toBe("遛猫照片");
    expect(metadata.width).toBe(2048);
    expect(metadata.height).toBe(683);
    expect(metadata.exif).toBeUndefined();
  });

  it("rejects non-image attachments", async () => {
    const fetchImpl: typeof globalThis.fetch = async () =>
      new Response("not an image", { headers: { "content-type": "application/pdf" } });

    await expect(
      downloadImageAttachments(
        [{ download_url: "https://files.example.test/file", file_id: "file_456" }],
        fetchImpl,
      ),
    ).rejects.toThrow("Only image attachments");
  });
});
