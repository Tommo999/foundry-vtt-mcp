import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/foundry-vtt-windows-setup.zip");

const fixedFiles = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  "setup-windows.cmd",
  "docs/installation.md",
  "docs/windows-setup.md",
  "docs/acceptance-checklist.md",
  "docs/security.md",
  "docs/tool-reference.md",
  "scripts/setup-windows.ps1",
  "scripts/windows-setup-helper.mjs",
  "scripts/package.mjs",
  "scripts/package-windows.mjs",
  "packages/shared/package.json",
  "packages/module/package.json",
  "packages/module/module.json",
  "packages/module/module.css",
  "packages/module/index.html",
  "packages/module/vite.config.ts",
  "packages/companion/package.json",
  "packages/companion/tsup.config.ts",
];

function collectSetupFiles(projectRoot = root) {
  const entries = [...fixedFiles];
  for (const sourceRoot of [
    "packages/shared/src",
    "packages/module/src",
    "packages/companion/src",
  ]) {
    const absolute = join(projectRoot, sourceRoot);
    if (!existsSync(absolute)) continue;
    entries.push(
      ...readdirSync(absolute)
        .filter((name) => name.endsWith(".ts"))
        .sort()
        .map((name) => `${sourceRoot}/${name}`),
    );
  }
  return [...new Set(entries)].sort();
}

function buildArchive({ projectRoot = root, destination = output } = {}) {
  const files = collectSetupFiles(projectRoot);
  const missing = files.filter((file) => !existsSync(join(projectRoot, file)));
  if (missing.length) {
    throw new Error(
      `Windows setup bundle inputs are missing:\n${missing.join("\n")}`,
    );
  }

  const destinationDir = dirname(destination);
  mkdirSync(destinationDir, { recursive: true });
  const staging = mkdtempSync(join(destinationDir, ".foundry-mcp-windows-"));
  const stagedArchive = `${destination}.tmp-${process.pid}.zip`;
  try {
    for (const file of files) {
      const target = join(staging, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(projectRoot, file), target);
    }

    let result;
    if (process.platform === "win32") {
      const escapedStage = staging.replaceAll("'", "''");
      const escapedArchive = stagedArchive.replaceAll("'", "''");
      const command = `Compress-Archive -Path '${escapedStage}\\*' -DestinationPath '${escapedArchive}' -Force`;
      result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { stdio: "inherit" },
      );
    } else {
      result = spawnSync("zip", ["-qr", stagedArchive, "."], {
        cwd: staging,
        stdio: "inherit",
      });
    }
    if (result.error || result.status !== 0 || !existsSync(stagedArchive)) {
      throw new Error(
        "Could not create Windows setup archive. Install zip (Unix) or use PowerShell (Windows).",
      );
    }

    rmSync(destination, { force: true });
    renameSync(stagedArchive, destination);
    return { destination, files };
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(stagedArchive, { force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = buildArchive();
    console.log(`Created ${result.destination} (${result.files.length} files)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { buildArchive, collectSetupFiles };
