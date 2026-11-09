import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const installerPath = join(projectRoot, "scripts", "setup-windows.ps1");
const configuredShell = process.env.FOUNDRY_MCP_PWSH_PATH;
const shell =
  configuredShell || (process.platform === "win32" ? "powershell.exe" : "pwsh");
const versionProbe = spawnSync(
  shell,
  ["-NoProfile", "-NonInteractive", "-Command", "exit 0"],
  {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(tmpdir(), "foundry-mcp-powershell-config"),
      XDG_CACHE_HOME: join(tmpdir(), "foundry-mcp-powershell-cache"),
      XDG_DATA_HOME: join(tmpdir(), "foundry-mcp-powershell-data"),
    },
  },
);
const shellAvailable = !versionProbe.error && versionProbe.status === 0;
const scratch = shellAvailable
  ? mkdtempSync(join(tmpdir(), "foundry-mcp-powershell-"))
  : null;

const harness = String.raw`param([Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($InstallerPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) {
  throw ('Installer PowerShell syntax errors: ' + (($parseErrors | ForEach-Object { $_.Message }) -join '; '))
}
$unsupportedKinds = @('AndAnd', 'OrOr', 'QuestionQuestion', 'QuestionQuestionEquals', 'QuestionDot', 'TernaryQuestionMark')
$unsupported = @($tokens | Where-Object { $unsupportedKinds -contains $_.Kind.ToString() })
if ($unsupported.Count -gt 0) {
  throw ('Installer uses PowerShell syntax newer than Windows PowerShell 5.1: ' + (($unsupported | ForEach-Object { $_.Kind.ToString() }) -join ', '))
}

. $InstallerPath
function Refresh-Path { }
function Find-Executable([string]$Name, [string[]]$KnownPaths) { return $null }
$tools = Get-Tools
if ($null -ne $tools.Node -or $null -ne $tools.Npm -or $null -ne $tools.Mkcert) {
  throw 'Empty-computer prerequisite detection should report no installed tools.'
}
$skipMessage = ''
try { Install-Prerequisites (Get-Tools) -Skip }
catch { $skipMessage = $_.Exception.Message }
if ($skipMessage -notmatch 'Prerequisites are missing or outdated') {
  throw ('Skip-prerequisites error was not clear: ' + $skipMessage)
}

$oldConfigDir = $env:FOUNDRY_MCP_CONFIG_DIR
try {
  $custom = Join-Path ([IO.Path]::GetTempPath()) 'foundry-mcp-custom-config'
  $env:FOUNDRY_MCP_CONFIG_DIR = $custom
  $expected = [IO.Path]::GetFullPath($custom)
  if ((Get-ConfigDirectory) -ne $expected) { throw 'FOUNDRY_MCP_CONFIG_DIR did not take precedence.' }
} finally {
  if ($null -eq $oldConfigDir) { Remove-Item Env:FOUNDRY_MCP_CONFIG_DIR -ErrorAction SilentlyContinue }
  else { $env:FOUNDRY_MCP_CONFIG_DIR = $oldConfigDir }
}

if ((Get-CanonicalOrigin 'https://vtt.example.test:8443') -ne 'https://vtt.example.test:8443') {
  throw 'A valid HTTPS Foundry origin was not canonicalized correctly.'
}
foreach ($invalidOrigin in @('http://vtt.example.test', 'https://user:pass@vtt.example.test', 'https://vtt.example.test/world')) {
  $rejected = $false
  try { $null = Get-CanonicalOrigin $invalidOrigin } catch { $rejected = $true }
  if (-not $rejected) { throw ('Invalid Foundry origin was accepted: ' + $invalidOrigin) }
}
Write-Output 'Windows installer PowerShell checks passed.'
`;

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("Windows PowerShell installer", () => {
  it.skipIf(!shellAvailable)(
    "parses and passes non-invasive bootstrap and input checks",
    () => {
      const harnessPath = join(scratch, "installer-harness.ps1");
      writeFileSync(harnessPath, harness, "utf8");
      const result = spawnSync(
        shell,
        ["-NoProfile", "-NonInteractive", "-File", harnessPath, installerPath],
        {
          encoding: "utf8",
          timeout: 30_000,
          env: {
            ...process.env,
            XDG_CONFIG_HOME: join(scratch, "config"),
            XDG_CACHE_HOME: join(scratch, "cache"),
            XDG_DATA_HOME: join(scratch, "data"),
          },
        },
      );
      expect(result.error?.message || "").toBe("");
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(
        "Windows installer PowerShell checks passed.",
      );
    },
  );
});
