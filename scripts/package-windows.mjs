import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
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
  "CHANGELOG.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "setup-windows.cmd",
  "docs/installation.md",
  "docs/release-v0.10.0.md",
  "docs/release-v0.11.0.md",
  "docs/release-v0.12.0.md",
  "docs/release-v0.13.0.md",
  "docs/architecture.md",
  "docs/maintenance.md",
  "docs/tool-change-guide.md",
  "docs/pf2e-change-guide.md",
  "docs/transport-change-guide.md",
  "docs/windows-setup.md",
  "docs/acceptance-checklist.md",
  "docs/security.md",
  "docs/tool-reference.md",
  "docs/spellcasting.md",
  "docs/spell-resolution.md",
  "docs/spell-history-recovery.md",
  "docs/spell-effects.md",
  "docs/roadmap.md",
  "scripts/setup-windows.ps1",
  "scripts/windows-setup-helper.mjs",
  "scripts/package.mjs",
  "scripts/package-windows.mjs",
  "scripts/prepare-release.mjs",
  "scripts/release-publication.mjs",
  "docs/public-releases.md",
  "packages/shared/package.json",
  "packages/module/package.json",
  "packages/module/module.json",
  "packages/module/module.css",
  "packages/module/index.html",
  "packages/module/vite.config.ts",
  "packages/companion/package.json",
  "packages/companion/tsup.config.ts",
];

const sourceRoots = [
  "packages/shared/src",
  "packages/module/src",
  "packages/companion/src",
];

function collectTypeScriptFiles(directory, sourceRoot, relativeDirectory = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      files.push(
        ...collectTypeScriptFiles(
          join(directory, entry.name),
          sourceRoot,
          relativePath,
        ),
      );
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(`${sourceRoot}/${relativePath}`);
    }
  }
  return files;
}

function collectSetupFiles(projectRoot = root) {
  const entries = [...fixedFiles];
  for (const sourceRoot of sourceRoots) {
    const absolute = join(projectRoot, sourceRoot);
    if (!existsSync(absolute)) continue;
    entries.push(...collectTypeScriptFiles(absolute, sourceRoot));
  }
  return [...new Set(entries)].sort();
}

function buildArchive({
  projectRoot = root,
  destination = output,
  fileOverrides = {},
} = {}) {
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
      if (Object.hasOwn(fileOverrides, file)) {
        writeFileSync(target, fileOverrides[file]);
      } else {
        copyFileSync(join(projectRoot, file), target);
      }
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
