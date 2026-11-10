import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPublicManifest,
  parseRepository,
  prepareRelease,
  validateReleaseInputs,
} from "../scripts/prepare-release.mjs";

const roots = [];
function fixture() {
  const path = mkdtempSync(join(os.tmpdir(), "foundry-release-test-"));
  roots.push(path);
  for (const file of [
    "package.json",
    "package-lock.json",
    "packages/shared/package.json",
    "packages/module/package.json",
    "packages/module/module.json",
    "packages/companion/package.json",
    "packages/companion/src/cli.ts",
  ]) {
    const target = join(path, file);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(join(process.cwd(), file), target);
  }
  mkdirSync(join(path, "packages/module/dist"), { recursive: true });
  cpSync(
    join(path, "packages/module/module.json"),
    join(path, "packages/module/dist/module.json"),
  );
  writeFileSync(join(path, "packages/module/dist/module.js"), "fixture module");
  writeFileSync(
    join(path, "packages/module/dist/module.css"),
    "fixture styles",
  );
  return path;
}

afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("public release preparation", () => {
  it("uses stable discovery and a version-pinned module download URL", () => {
    const manifest = buildPublicManifest(
      { id: "foundry-vtt-mcp", version: "0.8.1" },
      "Tommo999/foundry-vtt-mcp-releases",
    );
    expect(manifest.manifest).toBe(
      "https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/latest/download/module.json",
    );
    expect(manifest.download).toBe(
      "https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/download/v0.8.1/foundry-vtt-mcp.zip",
    );
    expect(manifest.url).toBe(
      "https://github.com/Tommo999/foundry-vtt-mcp-releases",
    );
  });

  it("rejects unsafe repository identifiers", () => {
    for (const value of [
      "https://github.com/a/b",
      "../b/c",
      "a/..",
      "-owner/repo",
      "a/b/extra",
      "a b/c",
      "a/repo\n",
    ]) {
      expect(() => parseRepository(value)).toThrow(/OWNER\/REPO/);
    }
  });

  it("requires all package, lockfile and module versions to agree", () => {
    const path = fixture();
    const pkgPath = join(path, "packages/module/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.version = "9.9.9";
    writeFileSync(pkgPath, JSON.stringify(pkg));
    expect(() => validateReleaseInputs(path)).toThrow(/versions do not agree/);
  });

  it("checks lockfile workspace versions", () => {
    const path = fixture();
    const lockPath = join(path, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.packages["packages/shared"].version = "0.8.0";
    writeFileSync(lockPath, JSON.stringify(lock));
    expect(() => validateReleaseInputs(path)).toThrow(
      /Lockfile workspace version mismatch/,
    );
  });

  it("checks the companion MCP server version", () => {
    const path = fixture();
    const cliPath = join(path, "packages/companion/src/cli.ts");
    const cli = readFileSync(cliPath, "utf8").replace(
      /version: MCP_SERVER_VERSION/,
      "version: companionPackage.version",
    );
    writeFileSync(cliPath, cli);
    expect(() => validateReleaseInputs(path)).toThrow(
      /Companion MCP advertised and diagnostic versions/,
    );
  });

  it("rejects a stale built module manifest", () => {
    const path = fixture();
    const builtManifest = join(path, "packages/module/dist/module.json");
    const manifest = JSON.parse(readFileSync(builtManifest, "utf8"));
    manifest.version = "0.0.0";
    writeFileSync(builtManifest, JSON.stringify(manifest));
    expect(() => validateReleaseInputs(path)).toThrow(/Built module version/);
  });

  it("refuses an existing release destination without changing its contents", () => {
    const path = fixture();
    const destination = join(path, "release");
    mkdirSync(destination);
    writeFileSync(join(destination, "keep.txt"), "previous content");
    expect(() =>
      prepareRelease({
        projectRoot: path,
        repository: "owner/repo",
        destination,
      }),
    ).toThrow(/already exists/);
    expect(readFileSync(join(destination, "keep.txt"), "utf8")).toBe(
      "previous content",
    );
  });
});
