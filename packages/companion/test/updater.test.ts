import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchBounded,
  PUBLIC_REPOSITORY,
  RELEASE_ASSETS,
  runUpgrade,
  stableTag,
} from "../src/updater.js";

const directories: string[] = [];
function temporaryDirectory() {
  const dir = mkdtempSync(join(tmpdir(), "foundry-updater-test-"));
  directories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function fixtureRelease() {
  const base = "https://github.com/" + PUBLIC_REPOSITORY;
  const manifest = {
    id: "foundry-vtt-mcp",
    version: "0.9.1",
    url: base,
    manifest: base + "/releases/latest/download/module.json",
    download: base + "/releases/download/v0.9.1/foundry-vtt-mcp.zip",
  };
  const assets = new Map<string, Buffer>([
    ["module.json", Buffer.from(JSON.stringify(manifest))],
    ["foundry-vtt-mcp.zip", Buffer.from("module zip fixture")],
    ["foundry-vtt-windows-setup.zip", Buffer.from("windows zip fixture")],
  ]);
  assets.set(
    "SHA256SUMS.txt",
    Buffer.from(
      [...assets]
        .map(
          ([name, body]) =>
            createHash("sha256").update(body).digest("hex") + "  " + name,
        )
        .join("\n") + "\n",
    ),
  );
  const release = {
    tag_name: "v0.9.1",
    draft: false,
    prerelease: false,
    assets: RELEASE_ASSETS.map((name) => ({
      name,
      browser_download_url: base + "/releases/download/v0.9.1/" + name,
    })),
  };
  return { assets, release };
}

function mockPublicFetch(
  assets: Map<string, Buffer>,
  release: any,
  mutateName?: string,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "api.github.com")
      return new Response(JSON.stringify(release));
    const name = url.pathname.split("/").at(-1)!;
    const body = Buffer.from(assets.get(name)!);
    if (name === mutateName) body[0] ^= 1;
    return new Response(body);
  }) as typeof fetch;
}

describe("safe upgrade staging", () => {
  it("accepts stable numeric tags only", () => {
    expect(stableTag("v0.10.0")).toBe(true);
    expect(stableTag("v0.10.0-rc.1")).toBe(false);
    expect(stableTag("v01.10.0")).toBe(false);
    expect(stableTag("v0.10.0/evil")).toBe(false);
  });

  it("rejects untrusted hosts and redirects and caps actual streamed bytes", async () => {
    const never = vi.fn();
    await expect(
      fetchBounded(
        new URL("https://evil.example/file"),
        "github.com",
        8,
        never,
      ),
    ).rejects.toThrow("rejected");
    expect(never).not.toHaveBeenCalled();
    const redirect = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/file" },
        }),
    );
    await expect(
      fetchBounded(
        new URL("https://github.com/file"),
        "github.com",
        8,
        redirect as typeof fetch,
      ),
    ).rejects.toThrow("rejected");
    expect(redirect).toHaveBeenCalledTimes(1);
    const oversized = vi.fn(async () => new Response("0123456789"));
    await expect(
      fetchBounded(
        new URL("https://github.com/file"),
        "github.com",
        4,
        oversized as typeof fetch,
      ),
    ).rejects.toThrow("size limit");
  });

  it("does not touch a pre-existing stage destination or its configuration sentinel", async () => {
    const root = temporaryDirectory();
    const destination = join(root, "existing");
    mkdirSync(destination);
    const sentinel = join(destination, "config.json");
    writeFileSync(sentinel, '{"preserve":true}');
    await expect(runUpgrade(["--stage", destination])).rejects.toThrow(
      "already exists",
    );
    expect(readFileSync(sentinel, "utf8")).toBe('{"preserve":true}');
  });

  it("stages the exact verified files without changing sibling configuration", async () => {
    const root = temporaryDirectory();
    const destination = join(root, "new-release");
    const config = join(root, "config.json");
    writeFileSync(config, '{"token":"preserve"}');
    const { assets, release } = fixtureRelease();
    const verifyStage = vi.fn((directory: string, tag: string) => {
      expect(tag).toBe("v0.9.1");
      expect(readdirSync(directory).sort()).toEqual([...RELEASE_ASSETS].sort());
    });
    const output = await runUpgrade(["--stage", destination], {
      currentVersion: "0.9.0",
      fetchImpl: mockPublicFetch(assets, release),
      verifyStage,
    });
    expect(output).toContain("No files were installed or executed");
    expect(verifyStage).toHaveBeenCalledOnce();
    expect(readdirSync(destination).sort()).toEqual([...RELEASE_ASSETS].sort());
    expect(readFileSync(config, "utf8")).toBe('{"token":"preserve"}');
  });

  it("rejects draft metadata, mismatched hashes and bundle validation failures before stage completion", async () => {
    const root = temporaryDirectory();
    const destination = join(root, "new-release");
    const { assets, release } = fixtureRelease();
    const draft = { ...release, prerelease: true };
    await expect(
      runUpgrade(["--stage", destination], {
        currentVersion: "0.9.0",
        fetchImpl: mockPublicFetch(assets, draft),
      }),
    ).rejects.toThrow("not a valid stable version");
    const validate = vi.fn();
    await expect(
      runUpgrade(["--stage", destination], {
        currentVersion: "0.9.0",
        fetchImpl: mockPublicFetch(assets, release, "module.json"),
        verifyStage: validate,
      }),
    ).rejects.toThrow("checksum mismatch");
    expect(validate).not.toHaveBeenCalled();
    expect(() => readdirSync(destination)).toThrow();
    await expect(
      runUpgrade(["--stage", destination], {
        currentVersion: "0.9.0",
        fetchImpl: mockPublicFetch(assets, release),
        verifyStage: () => {
          throw new Error("manifest or ZIP validation failed");
        },
      }),
    ).rejects.toThrow("manifest or ZIP validation failed");
    expect(() => readdirSync(destination)).toThrow();
  });

  it("refuses staging an older release over the running companion", async () => {
    const root = temporaryDirectory();
    const { assets, release } = fixtureRelease();
    await expect(
      runUpgrade(["--stage", join(root, "older")], {
        currentVersion: "0.10.0",
        fetchImpl: mockPublicFetch(assets, release),
      }),
    ).rejects.toThrow("Refusing to stage older");
    expect(() => readdirSync(join(root, "older"))).toThrow();
  });
});
