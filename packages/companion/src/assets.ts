import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { MAX_ASSET_BYTES } from "@foundry-mcp/shared";

const assetTypes: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/avif": [".avif"],
};

function validateImage(
  bytes: Buffer,
  filename: string,
  mimeType: string,
): void {
  const extensions = assetTypes[mimeType];
  const extension = path.extname(filename).toLowerCase();
  if (!extensions || !extensions.includes(extension)) {
    throw new Error(
      "Asset filename extension must match the selected image type.",
    );
  }

  const signatures: Record<string, (data: Buffer) => boolean> = {
    "image/png": (data) =>
      data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/jpeg": (data) =>
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff,
    "image/webp": (data) =>
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP",
    "image/gif": (data) =>
      ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6)),
    "image/avif": (data) =>
      data.toString("ascii", 4, 8) === "ftyp" &&
      ["avif", "avis"].includes(data.toString("ascii", 8, 12)),
  };
  if (!signatures[mimeType]?.(bytes)) {
    throw new Error("Image contents do not match the selected MIME type.");
  }
}

async function readLocalImage(localPath: string): Promise<Buffer> {
  let handle: fs.FileHandle | undefined;
  try {
    const pathStat = await fs.lstat(localPath);
    if (!pathStat.isFile()) {
      throw new Error(
        "Asset path must point to a regular file, not a directory, link, or special file.",
      );
    }
    if (pathStat.size > MAX_ASSET_BYTES) {
      throw new Error("Image exceeds the 8 MiB upload limit.");
    }

    const flags =
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0);
    handle = await fs.open(localPath, flags);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.dev !== pathStat.dev ||
      stat.ino !== pathStat.ino
    ) {
      throw new Error(
        "Asset path changed while it was being opened; retry with a stable file.",
      );
    }
    if (stat.size > MAX_ASSET_BYTES) {
      throw new Error("Image exceeds the 8 MiB upload limit.");
    }

    const buffer = Buffer.alloc(Math.min(MAX_ASSET_BYTES + 1, stat.size + 1));
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > MAX_ASSET_BYTES) {
      throw new Error("Image exceeds the 8 MiB upload limit.");
    }
    if (bytesRead !== stat.size) {
      throw new Error(
        "Image changed while it was being read; retry with a stable file.",
      );
    }
    return buffer.subarray(0, bytesRead);
  } catch (error) {
    if (
      error instanceof Error &&
      /^(Asset path|Image exceeds|Image changed)/.test(error.message)
    ) {
      throw error;
    }
    throw new Error(
      "Could not read local image file. Check that the selected file exists and is accessible.",
    );
  } finally {
    await handle?.close();
  }
}

export async function prepareUploadAsset(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { filename, mimeType, dataBase64, localPath } = args;
  if (typeof filename !== "string" || typeof mimeType !== "string") {
    throw new Error(
      "Upload requires a filename and supported image MIME type.",
    );
  }
  if (
    /[\\/\x00-\x1f\x7f]/.test(filename) ||
    filename === "." ||
    filename === ".."
  ) {
    throw new Error(
      "Filename must be a simple file name without directory components.",
    );
  }
  const hasBase64 = typeof dataBase64 === "string";
  const hasLocalPath = typeof localPath === "string";
  if (hasBase64 === hasLocalPath) {
    throw new Error(
      "Provide exactly one image source: dataBase64 or localPath.",
    );
  }

  let bytes: Buffer;
  if (hasBase64) {
    const encoded = dataBase64 as string;
    bytes = Buffer.from(encoded, "base64");
    if (!encoded || bytes.toString("base64") !== encoded) {
      throw new Error("dataBase64 must use canonical base64 encoding.");
    }
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new Error("Image exceeds the 8 MiB upload limit.");
    }
  } else {
    bytes = await readLocalImage(localPath as string);
  }

  validateImage(bytes, filename, mimeType);
  const { localPath: _localPath, ...rest } = args;
  return { ...rest, dataBase64: bytes.toString("base64") };
}
