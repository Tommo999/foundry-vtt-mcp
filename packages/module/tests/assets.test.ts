import { describe, expect, it } from "vitest";
import {
  canonicalRelativePath,
  decodeImageBase64,
  validateImageFilename,
} from "../src/assets";

describe("asset path and image validation", () => {
  it("rejects traversal, absolute, encoded, and backslash paths", () => {
    for (const path of [
      "../modules/x",
      "/tmp/x",
      "assets/%2e%2e",
      "assets\\evil",
    ])
      expect(() => canonicalRelativePath(path)).toThrow();
    expect(canonicalRelativePath("maps/fantasy art")).toBe("maps/fantasy art");
  });
  it("checks extensions and actual image signatures", () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    expect(
      decodeImageBase64(btoa(String.fromCharCode(...png)), "image/png"),
    ).toHaveLength(9);
    expect(() => decodeImageBase64(btoa("not an image"), "image/png")).toThrow(
      /match/,
    );
    expect(() => validateImageFilename("map.svg", "image/png")).toThrow(
      /extension/,
    );
  });
});
