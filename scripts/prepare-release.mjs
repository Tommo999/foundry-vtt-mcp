import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildArchive } from "./package-windows.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseRepository(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error("Repository must be OWNER/REPO using GitHub names.");
  }
  const [owner, repo, ...extra] = (value ?? "").split("/");
  if (
    extra.length ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner ?? "") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repo ?? "")
  ) {
    throw new Error("Repository must be OWNER/REPO using GitHub names.");
  }
  return value;
}

function buildPublicManifest(sourceManifest, repository) {
  const repo = parseRepository(repository);
  const version = sourceManifest.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    throw new Error("Invalid module version: " + String(version));
  }
  const base = "https://github.com/" + repo;
  return {
    ...sourceManifest,
    url: base,
    manifest: base + "/releases/latest/download/module.json",
    download: base + "/releases/download/v" + version + "/foundry-vtt-mcp.zip",
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateReleaseInputs(projectRoot = root) {
  const rootPackage = readJson(join(projectRoot, "package.json"));
  const sharedPackage = readJson(
    join(projectRoot, "packages/shared/package.json"),
  );
  const modulePackage = readJson(
    join(projectRoot, "packages/module/package.json"),
  );
  const companionPackage = readJson(
    join(projectRoot, "packages/companion/package.json"),
  );
  const lock = readJson(join(projectRoot, "package-lock.json"));
  const sourceManifest = readJson(
    join(projectRoot, "packages/module/module.json"),
  );
  const versions = [
    rootPackage.version,
    lock.version,
    lock.packages?.[""]?.version,
    sharedPackage.version,
    modulePackage.version,
    companionPackage.version,
    sourceManifest.version,
  ];
  if (versions.some((version) => !version || version !== versions[0])) {
    throw new Error("Release versions do not agree: " + versions.join(", "));
  }
  for (const [name, pkg] of [
    ["packages/shared", sharedPackage],
    ["packages/module", modulePackage],
    ["packages/companion", companionPackage],
  ]) {
    if (lock.packages?.[name]?.version !== pkg.version) {
      throw new Error("Lockfile workspace version mismatch for " + name + ".");
    }
  }
  for (const pkg of [modulePackage, companionPackage]) {
    if (pkg.dependencies?.["@foundry-mcp/shared"] !== versions[0]) {
      throw new Error(
        pkg.name +
          " must depend on @foundry-mcp/shared at " +
          versions[0] +
          ".",
      );
    }
  }
  for (const name of ["packages/module", "packages/companion"]) {
    if (
      lock.packages?.[name]?.dependencies?.["@foundry-mcp/shared"] !==
      versions[0]
    ) {
      throw new Error(
        "Lockfile internal dependency mismatch for " + name + ".",
      );
    }
  }
  const cli = readFileSync(
    join(projectRoot, "packages/companion/src/cli.ts"),
    "utf8",
  );
  const serverVersionConstant = cli.match(
    /const MCP_SERVER_VERSION\s*=\s*companionPackage\.version\s*;/,
  );
  const serverVersionReference = cli.match(
    /new McpServer\(\{\s*name:\s*["']foundry-vtt["'],\s*version:\s*([A-Za-z0-9_.]+)\s*,?\s*\}/,
  );
  const diagnosticVersions = [
    ...cli.matchAll(/mcpServer:\s*([A-Z_][A-Z0-9_]*)/g),
  ].map((match) => match[1]);
  if (
    !serverVersionConstant ||
    serverVersionReference?.[1] !== "MCP_SERVER_VERSION" ||
    diagnosticVersions.length !== 2 ||
    diagnosticVersions.some((value) => value !== "MCP_SERVER_VERSION")
  ) {
    throw new Error(
      "Companion MCP advertised and diagnostic versions must use MCP_SERVER_VERSION from its package version.",
    );
  }
  const builtDir = join(projectRoot, "packages/module/dist");
  const builtManifestPath = join(builtDir, "module.json");
  if (!existsSync(builtManifestPath)) {
    throw new Error(
      "Module build not found: expected packages/module/dist/module.json.",
    );
  }
  const builtManifest = readJson(builtManifestPath);
  if (builtManifest.version !== versions[0]) {
    throw new Error(
      "Built module version " +
        builtManifest.version +
        " does not match " +
        versions[0] +
        ".",
    );
  }
  for (const asset of ["module.js", "module.css"]) {
    if (!existsSync(join(builtDir, asset)))
      throw new Error("Module build is missing " + asset + ".");
  }
  return { version: versions[0], sourceManifest, builtManifest };
}

function makeZip(sourceDirectory, archivePath) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Compress-Archive -Path '" +
              sourceDirectory.replaceAll("'", "''") +
              "\\*' -DestinationPath '" +
              archivePath.replaceAll("'", "''") +
              "'",
          ],
          { stdio: "inherit" },
        )
      : spawnSync("zip", ["-qr", archivePath, "."], {
          cwd: sourceDirectory,
          stdio: "inherit",
        });
  if (result.error || result.status !== 0 || !existsSync(archivePath)) {
    throw new Error(
      "Could not create release ZIP. Install zip (Unix) or use PowerShell (Windows).",
    );
  }
}

function prepareRelease({ projectRoot = root, repository, destination } = {}) {
  const repo = parseRepository(repository);
  const { version, sourceManifest } = validateReleaseInputs(projectRoot);
  const releaseManifest = buildPublicManifest(sourceManifest, repo);
  const releaseDir =
    destination ?? join(projectRoot, "dist/releases", "v" + version);
  if (existsSync(releaseDir))
    throw new Error("Release destination already exists: " + releaseDir);
  const parent = dirname(releaseDir);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, ".release-v" + version + "-"));
  const finalStage = join(staging, "v" + version);
  mkdirSync(finalStage);
  try {
    const manifestText = JSON.stringify(releaseManifest, null, 2) + "\n";
    writeFileSync(join(finalStage, "module.json"), manifestText);
    const moduleStage = join(staging, "module");
    mkdirSync(moduleStage);
    for (const file of ["module.js", "module.css"]) {
      copyFileSync(
        join(projectRoot, "packages/module/dist", file),
        join(moduleStage, file),
      );
    }
    writeFileSync(join(moduleStage, "module.json"), manifestText);
    makeZip(moduleStage, join(finalStage, "foundry-vtt-mcp.zip"));
    buildArchive({
      projectRoot,
      destination: join(finalStage, "foundry-vtt-windows-setup.zip"),
      fileOverrides: { "packages/module/module.json": manifestText },
    });
    const files = [
      "module.json",
      "foundry-vtt-mcp.zip",
      "foundry-vtt-windows-setup.zip",
    ];
    const checksums =
      files
        .map(
          (file) =>
            createHash("sha256")
              .update(readFileSync(join(finalStage, file)))
              .digest("hex") +
            "  " +
            file,
        )
        .join("\n") + "\n";
    writeFileSync(join(finalStage, "SHA256SUMS.txt"), checksums);
    if (existsSync(releaseDir))
      throw new Error("Release destination already exists: " + releaseDir);
    renameSync(finalStage, releaseDir);
    return { destination: releaseDir, version, repository: repo };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const index = process.argv.indexOf("--repository");
    if (index < 0 || !process.argv[index + 1]) {
      throw new Error(
        "Usage: npm run release:prepare -- --repository OWNER/REPO",
      );
    }
    const result = prepareRelease({ repository: process.argv[index + 1] });
    console.log(
      "Prepared " +
        result.repository +
        " v" +
        result.version +
        " assets in " +
        result.destination,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export {
  buildPublicManifest,
  parseRepository,
  prepareRelease,
  validateReleaseInputs,
};
