import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildArchive,
  collectSetupFiles,
} from "../scripts/package-windows.mjs";

const temporaryRoots = [];

function makeFixture() {
  const root = mkdtempSync(join(os.tmpdir(), "foundry-windows-package-test-"));
  temporaryRoots.push(root);
  for (const file of collectSetupFiles(root)) {
    const fullPath = join(root, file);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, `fixture: ${file}\n`);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Windows setup source bundle allowlist", () => {
  it("includes setup/build inputs and excludes generated, private, and unrelated files", () => {
    const files = collectSetupFiles();
    for (const required of [
      "package-lock.json",
      "AGENTS.md",
      "CONTRIBUTING.md",
      "docs/architecture.md",
      "docs/maintenance.md",
      "docs/public-releases.md",
      "docs/spellcasting.md",
      "scripts/prepare-release.mjs",
      "setup-windows.cmd",
      "scripts/setup-windows.ps1",
      "scripts/windows-setup-helper.mjs",
      "packages/module/src/main.ts",
      "packages/companion/src/cli.ts",
      "packages/shared/src/index.ts",
    ])
      expect(files).toContain(required);
    for (const excluded of [
      "packages/companion/dist/cli.js",
      ".env",
      "localhost.pem",
      "localhost-key.pem",
      "node_modules/vite/package.json",
      "dist/foundry-vtt-mcp.zip",
      "tests/windows-package.test.mjs",
      "config.json",
    ])
      expect(files).not.toContain(excluded);
  });

  it("checks all required inputs before replacing an existing archive", () => {
    const root = makeFixture();
    const destination = join(root, "dist", "existing.zip");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "previous archive remains intact");
    rmSync(join(root, "scripts", "setup-windows.ps1"));

    expect(() => buildArchive({ projectRoot: root, destination })).toThrow(
      /setup-windows\.ps1/,
    );
    expect(readFileSync(destination, "utf8")).toBe(
      "previous archive remains intact",
    );
  });
});
