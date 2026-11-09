import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
const root = resolve(import.meta.dirname, "..");
const moduleDir = resolve(root, "packages/module/dist");
const outputDir = resolve(root, "dist");
const archive = resolve(outputDir, "foundry-vtt-mcp.zip");
if (!existsSync(resolve(moduleDir, "module.json"))) {
  console.error(
    "Module build not found: expected packages/module/dist/module.json",
  );
  process.exit(1);
}
mkdirSync(outputDir, { recursive: true });
rmSync(archive, { force: true });
let result;
if (process.platform === "win32") {
  const command =
    "Compress-Archive -Path '" +
    moduleDir.replaceAll("'", "''") +
    "\\*' -DestinationPath '" +
    archive.replaceAll("'", "''") +
    "'";
  result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { stdio: "inherit" },
  );
} else {
  result = spawnSync("zip", ["-qr", archive, "."], {
    cwd: moduleDir,
    stdio: "inherit",
  });
}
if (result.error || result.status !== 0) {
  console.error(
    "Could not create module archive. Install zip (Unix) or PowerShell (Windows).",
  );
  process.exit(1);
}
console.log("Created " + archive);
