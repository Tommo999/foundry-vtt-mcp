import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateTlsFiles } from "../src/config.js";
import { prepareUploadAsset } from "../src/assets.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
let dir: string;
let cert: string;
let key: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-mcp-assets-"));
  cert = path.join(dir, "cert.pem");
  key = path.join(dir, "key.pem");
  fs.writeFileSync(
    cert,
    "-----BEGIN CERTIFICATE-----\\ninvalid\\n-----END CERTIFICATE-----",
  );
  fs.writeFileSync(
    key,
    "-----BEGIN PRIVATE KEY-----\\ninvalid\\n-----END PRIVATE KEY-----",
  );
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("asset upload preprocessing", () => {
  it("reads local image bytes and strips the local path", async () => {
    const localPath = path.join(dir, "image.png");
    fs.writeFileSync(localPath, png);
    const args = await prepareUploadAsset({
      filename: "image.png",
      mimeType: "image/png",
      localPath,
      directory: "maps",
    });
    expect(args.localPath).toBeUndefined();
    expect(args.dataBase64).toBe(png.toString("base64"));
  });

  it("requires exactly one source", async () => {
    const base = { filename: "image.png", mimeType: "image/png" };
    await expect(prepareUploadAsset(base)).rejects.toThrow("exactly one");
    await expect(
      prepareUploadAsset({
        ...base,
        dataBase64: png.toString("base64"),
        localPath: "/tmp/image.png",
      }),
    ).rejects.toThrow("exactly one");
  });

  it("rejects files larger than 8 MiB and non-regular files", async () => {
    const oversizedPath = path.join(dir, "large.png");
    fs.writeFileSync(oversizedPath, Buffer.alloc(8 * 1024 * 1024 + 1));
    await expect(
      prepareUploadAsset({
        filename: "large.png",
        mimeType: "image/png",
        localPath: oversizedPath,
      }),
    ).rejects.toThrow("8 MiB");
    await expect(
      prepareUploadAsset({
        filename: "directory.png",
        mimeType: "image/png",
        localPath: dir,
      }),
    ).rejects.toThrow("regular file");
  });

  it("reports a directory passed as the CA certificate before config creation", () => {
    expect(() => validateTlsFiles(cert, key, dir)).toThrow(
      "CA certificate path must be a PEM file",
    );
  });
});
