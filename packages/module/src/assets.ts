import { MAX_ASSET_BYTES } from "@foundry-mcp/shared";
const allowed: Record<
  string,
  { ext: string[]; signature: (bytes: Uint8Array) => boolean }
> = {
  "image/png": {
    ext: ["png"],
    signature: (b) =>
      b.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v),
  },
  "image/jpeg": {
    ext: ["jpg", "jpeg"],
    signature: (b) =>
      b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255,
  },
  "image/webp": {
    ext: ["webp"],
    signature: (b) =>
      b.length >= 12 &&
      String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
  "image/gif": {
    ext: ["gif"],
    signature: (b) =>
      b.length >= 6 &&
      ["GIF87a", "GIF89a"].includes(String.fromCharCode(...b.slice(0, 6))),
  },
  "image/avif": {
    ext: ["avif"],
    signature: (b) =>
      b.length >= 12 &&
      String.fromCharCode(...b.slice(4, 12)).includes("ftypavif"),
  },
};
export function canonicalRelativePath(value: string): string {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes(":") ||
    value.startsWith("/") ||
    value.startsWith("~")
  )
    throw new Error("Path must be a safe relative path.");
  const segments = value.split("/").filter(Boolean);
  if (
    segments.some(
      (part) =>
        part === "." || part === ".." || !/^[a-zA-Z0-9 _.-]+$/.test(part),
    )
  )
    throw new Error("Path contains an unsafe segment.");
  return segments.join("/");
}
export function decodeImageBase64(data: string, mime: string): Uint8Array {
  if (!allowed[mime]) throw new Error("Unsupported image MIME type.");
  if (
    data.length > 11_184_812 ||
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  )
    throw new Error("Image data must be canonical base64.");
  const binary = atob(data);
  if (binary.length > MAX_ASSET_BYTES)
    throw new Error("Image exceeds the 8 MiB size limit.");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (!allowed[mime].signature(bytes))
    throw new Error("Image contents do not match the declared MIME type.");
  return bytes;
}
export function validateImageFilename(filename: string, mime: string): string {
  const clean = filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const ext = clean.split(".").pop()?.toLowerCase();
  if (!clean || !ext || !allowed[mime]?.ext.includes(ext))
    throw new Error("Filename extension does not match the image MIME type.");
  return clean;
}
