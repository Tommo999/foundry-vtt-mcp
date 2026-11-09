#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const SAFE_TOKEN = /^[a-f0-9]{64}$/i;
const isAbsolutePath = (value) =>
  path.isAbsolute(value) || path.win32.isAbsolute(value);

function readConfig(configPath) {
  const absolute = path.resolve(configPath);
  const stat = fs.statSync(absolute);
  if (!stat.isFile())
    throw new Error("Configuration path must be a regular file.");
  let config;
  try {
    config = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch {
    throw new Error("Configuration file is not valid JSON.");
  }
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("Configuration is invalid.");
  return config;
}

function inspectFields(config) {
  let url;
  try {
    url = new URL(config.origin);
  } catch {
    throw new Error("Configuration origin must be a valid HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Configuration origin must be HTTPS without credentials, query, or fragment.",
    );
  }
  const port = config.port === undefined ? 31415 : config.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Configuration port must be an integer from 1 to 65535.");
  for (const key of ["certPath", "keyPath", "caPath"]) {
    if (
      typeof config[key] !== "string" ||
      !isAbsolutePath(config[key]) ||
      /[\0\r\n]/.test(config[key])
    ) {
      throw new Error(`Configuration ${key} must be an absolute file path.`);
    }
  }
  return {
    origin: url.origin,
    port,
    certPath: config.certPath,
    keyPath: config.keyPath,
    caPath: config.caPath,
  };
}

export function inspectConfig(configPath) {
  return inspectFields(readConfig(configPath));
}

function readPem(filePath, label) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file.`);
  const data = fs.readFileSync(filePath);
  if (!data.includes(Buffer.from("-----BEGIN CERTIFICATE-----")))
    throw new Error(`${label} must contain a PEM certificate.`);
  return data;
}

export function validateConfig(configPath) {
  const config = readConfig(configPath);
  const fields = inspectFields(config);
  if (typeof config.token !== "string" || !SAFE_TOKEN.test(config.token))
    throw new Error("Configuration pairing token is invalid.");
  validateTlsFiles(fields.certPath, fields.keyPath, fields.caPath);
  return { valid: true, ...fields };
}

export function validateTlsFiles(certPath, keyPath, caPath) {
  const paths = { certPath, keyPath, caPath };
  for (const [name, value] of Object.entries(paths)) {
    if (
      typeof value !== "string" ||
      !isAbsolutePath(value) ||
      /[\0\r\n]/.test(value)
    )
      throw new Error(`${name} must be an absolute file path.`);
  }
  const certPem = readPem(certPath, "TLS certificate");
  const caPem = readPem(caPath, "CA certificate");
  if (!fs.statSync(keyPath).isFile())
    throw new Error("Private key must be a regular file.");
  const keyPem = fs.readFileSync(keyPath);
  try {
    const cert = new crypto.X509Certificate(certPem);
    const ca = new crypto.X509Certificate(caPem);
    const now = Date.now();
    if (
      Date.parse(cert.validFrom) > now ||
      Date.parse(cert.validTo) <= now ||
      Date.parse(ca.validFrom) > now ||
      Date.parse(ca.validTo) <= now ||
      !cert.checkHost("localhost") ||
      !cert.checkIP("127.0.0.1") ||
      !cert.checkPrivateKey(crypto.createPrivateKey(keyPem)) ||
      !cert.verify(ca.publicKey)
    )
      throw new Error();
    tls.createSecureContext({ cert: certPem, key: keyPem, ca: caPem });
  } catch {
    throw new Error(
      "TLS certificate, private key, or CA is invalid, expired, mismatched, or lacks localhost SANs.",
    );
  }
  return { valid: true, ...paths };
}

function pwsh(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value))
    throw new Error("Paths must not contain NUL or line breaks.");
  return `'${value.replaceAll("'", "''")}'`;
}
function tomlString(value) {
  return JSON.stringify(value.replaceAll("\\", "/"));
}
function joinConfiguredPath(directory, ...parts) {
  return path.win32.isAbsolute(directory) && !path.isAbsolute(directory)
    ? path.win32.join(directory, ...parts)
    : path.join(directory, ...parts);
}

export function renderArtifacts({
  nodePath,
  cliPath,
  configDir,
  helperPath = fileURLToPath(import.meta.url),
  port = 31415,
}) {
  for (const [name, value] of Object.entries({
    nodePath,
    cliPath,
    configDir,
    helperPath,
  })) {
    if (
      typeof value !== "string" ||
      !isAbsolutePath(value) ||
      /[\0\r\n]/.test(value)
    )
      throw new Error(`${name} must be an absolute path without line breaks.`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("port must be an integer from 1 to 65535.");
  const node = pwsh(nodePath);
  const cli = pwsh(cliPath);
  const config = pwsh(configDir);
  const helper = pwsh(helperPath);
  const configFile = pwsh(joinConfiguredPath(configDir, "config.json"));
  const startScript = `$ErrorActionPreference = 'Stop'\n$env:FOUNDRY_MCP_CONFIG_DIR = ${config}\n$env:FOUNDRY_MCP_PORT = '${port}'\n$nodePath = ${node}\n$cliPath = ${cli}\n$helperPath = ${helper}\n$configPath = ${configFile}\ntry {\n  $oldErrorActionPreference = $ErrorActionPreference\n  $ErrorActionPreference = 'Continue'\n  $probeOutput = & $nodePath $helperPath probe-config $configPath 2>&1\n  $probeExitCode = $LASTEXITCODE\n  $ErrorActionPreference = $oldErrorActionPreference\n  if ($probeExitCode -ne 0) { throw "Could not safely inspect the configured local companion. Check the certificate and whether another service is using port ${port}." }\n  $probe = ($probeOutput -join [Environment]::NewLine) | ConvertFrom-Json\n  if ($probe.running) { Write-Host 'Foundry MCP companion is already running.'; exit 0 }\n  $oldErrorActionPreference = $ErrorActionPreference\n  $ErrorActionPreference = 'Continue'\n  & $nodePath $cliPath start\n  $startExitCode = $LASTEXITCODE\n  $ErrorActionPreference = $oldErrorActionPreference\n  if ($startExitCode -ne 0) { throw "Companion exited with code $startExitCode" }\n} catch {\n  Write-Host $_ -ForegroundColor Red\n  Read-Host 'Press Enter to close'\n  exit 1\n}\n`;
  const statusScript = `$ErrorActionPreference = 'Stop'\n$env:FOUNDRY_MCP_CONFIG_DIR = ${config}\n$nodePath = ${node}\n$cliPath = ${cli}\n$oldErrorActionPreference = $ErrorActionPreference\n$ErrorActionPreference = 'Continue'\n& $nodePath $cliPath status\n$statusExitCode = $LASTEXITCODE\n$ErrorActionPreference = $oldErrorActionPreference\nexit $statusExitCode\n`;
  const clientConfig = {
    mcpServers: {
      "foundry-vtt": {
        command: nodePath,
        args: [cliPath, "mcp"],
        env: { FOUNDRY_MCP_CONFIG_DIR: configDir },
      },
    },
  };
  const codexConfig = `[mcp_servers.foundry-vtt]\ncommand = ${tomlString(nodePath)}\nargs = [${tomlString(cliPath)}, "mcp"]\nstartup_timeout_sec = 20\ntool_timeout_sec = 330\n\n[mcp_servers.foundry-vtt.env]\nFOUNDRY_MCP_CONFIG_DIR = ${tomlString(configDir)}\n`;
  return { startScript, statusScript, clientConfig, codexConfig };
}

export function writeArtifacts({ nodePath, cliPath, configDir, outputDir }) {
  if (
    typeof outputDir !== "string" ||
    !path.isAbsolute(outputDir) ||
    /[\0\r\n]/.test(outputDir)
  )
    throw new Error("outputDir must be an absolute path.");
  const configPath = path.join(configDir, "config.json");
  const fields = validateConfig(configPath);
  const config = readConfig(configPath);
  const { startScript, statusScript, clientConfig, codexConfig } =
    renderArtifacts({ nodePath, cliPath, configDir, port: fields.port });
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const files = {
    startScript: path.join(outputDir, "start-companion.ps1"),
    statusScript: path.join(outputDir, "check-status.ps1"),
    clientConfig: path.join(outputDir, "foundry-mcp-client.json"),
    codexConfig: path.join(outputDir, "foundry-mcp-codex.toml"),
    pairingInstructions: path.join(outputDir, "pairing-instructions.txt"),
  };
  const contents = [
    `\uFEFF${startScript}`,
    `\uFEFF${statusScript}`,
    `${JSON.stringify(clientConfig, null, 2)}\n`,
    codexConfig,
    `Foundry VTT MCP pairing\n\nEndpoint: wss://127.0.0.1:${fields.port}/bridge\nPairing token: ${config.token}\n\nIn Foundry, enable the Foundry VTT MCP module and enter the endpoint and pairing token in its settings. Keep this file private.\n`,
  ];
  Object.values(files).forEach((file, i) => {
    fs.writeFileSync(file, contents[i], { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {}
  });
  try {
    fs.chmodSync(outputDir, 0o700);
  } catch {}
  return { files, origin: fields.origin, port: fields.port };
}

export function showPairing(configPath) {
  const config = readConfig(configPath);
  const fields = inspectFields(config);
  if (typeof config.token !== "string" || !SAFE_TOKEN.test(config.token))
    throw new Error("Configuration pairing token is invalid.");
  return {
    origin: fields.origin,
    port: fields.port,
    endpoint: `wss://127.0.0.1:${fields.port}/bridge`,
    token: config.token,
  };
}

export async function probeConfig(configPath) {
  const config = readConfig(configPath);
  const fields = validateConfig(configPath);
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    tool: "get_status",
    args: {},
  });
  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: fields.port,
        path: "/rpc",
        method: "POST",
        servername: "localhost",
        ca: fs.readFileSync(fields.caPath),
        timeout: 2000,
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          let result;
          try {
            result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return reject(
              new Error("Local companion returned an invalid response."),
            );
          }
          if (res.statusCode === 401 || res.statusCode === 403)
            return reject(
              new Error(
                "Local companion rejected the configured credentials or host.",
              ),
            );
          if (
            res.statusCode !== 200 ||
            !result ||
            result.ok !== true ||
            !result.data ||
            typeof result.data.connected !== "boolean"
          )
            return reject(
              new Error(
                "Local companion returned an unexpected status response.",
              ),
            );
          resolve({
            running: true,
            paired: result.data.connected,
            port: fields.port,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => {
      if (error.code === "ECONNREFUSED")
        resolve({ running: false, port: fields.port });
      else
        reject(
          new Error(
            error.code === "CERT_HAS_EXPIRED" ||
              error.code === "ERR_TLS_CERT_ALTNAME_INVALID"
              ? "Local companion TLS certificate validation failed."
              : "Local companion probe failed; check the configured port and certificate.",
          ),
        );
    });
    req.end(body);
  });
}

async function main(argv) {
  const [command, ...args] = argv;
  let result;
  if (command === "inspect-config" && args.length === 1)
    result = inspectConfig(args[0]);
  else if (command === "validate-config" && args.length === 1)
    result = validateConfig(args[0]);
  else if (command === "validate-tls" && args.length === 3)
    result = validateTlsFiles(...args);
  else if (command === "show-pairing" && args.length === 1)
    result = showPairing(args[0]);
  else if (command === "probe-config" && args.length === 1)
    result = await probeConfig(args[0]);
  else if (command === "write-artifacts") {
    const opts = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!args[i]?.startsWith("--") || !args[i + 1])
        throw new Error("Invalid write-artifacts arguments.");
      opts[args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] =
        args[i + 1];
    }
    result = writeArtifacts(opts);
  } else
    throw new Error(
      "Usage: inspect-config|validate-config|show-pairing|probe-config <configPath> | validate-tls <certPath> <keyPath> <caPath> | write-artifacts --node-path <path> --cli-path <path> --config-dir <path> --output-dir <path>",
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Windows setup helper failed."}\n`,
    );
    process.exitCode = 1;
  });
}
