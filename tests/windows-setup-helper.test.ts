import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
const {
  inspectConfig,
  validateConfig,
  renderArtifacts,
  writeArtifacts,
  showPairing,
  probeConfig,
} = await import(
  new URL("../scripts/windows-setup-helper.mjs", import.meta.url).href
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let tempDirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-mcp-setup-"));
  tempDirs.push(dir);
  const certPath = path.join(dir, "localhost.pem");
  const keyPath = path.join(dir, "localhost-key.pem");
  fs.copyFileSync(path.join(root, "tests/fixtures/localhost.pem"), certPath);
  fs.copyFileSync(path.join(root, "tests/fixtures/localhost-key.pem"), keyPath);
  const config = {
    origin: "https://example.invalid:30000",
    port: 31415,
    certPath,
    keyPath,
    caPath: certPath,
    token: "a".repeat(64),
  };
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config));
  return { dir, config, configPath };
}
afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("Windows setup helper", () => {
  it("inspects and validates an existing config without exposing or changing its token", () => {
    const { config, configPath } = fixture();
    const before = fs.readFileSync(configPath, "utf8");
    expect(inspectConfig(configPath)).toEqual({
      origin: config.origin,
      port: 31415,
      certPath: config.certPath,
      keyPath: config.keyPath,
      caPath: config.caPath,
    });
    expect(validateConfig(configPath)).toMatchObject({
      valid: true,
      port: 31415,
    });
    expect(JSON.stringify(inspectConfig(configPath))).not.toContain(
      config.token,
    );
    expect(JSON.stringify(validateConfig(configPath))).not.toContain(
      config.token,
    );
    expect(fs.readFileSync(configPath, "utf8")).toBe(before);
  });

  it("rejects malformed credentials, unsafe origins, directories, and invalid ports", () => {
    const { config, configPath, dir } = fixture();
    for (const change of [
      { token: "secret" },
      { origin: "https://user:pass@example.invalid" },
      { origin: "http://example.invalid" },
      { port: 65536 },
      { caPath: dir },
    ]) {
      fs.writeFileSync(configPath, JSON.stringify({ ...config, ...change }));
      expect(() => validateConfig(configPath)).toThrow();
    }
  });

  it("renders safely quoted launchers and client configs with no pairing secret", () => {
    const paths = {
      nodePath: "C:\\Program Files\\Node's $x\\node.exe",
      cliPath: "C:\\MCP & Tools\\cli.js",
      configDir: "C:\\Users\\A B\\.config\\foundry-mcp",
    };
    const rendered = renderArtifacts({
      ...paths,
      helperPath: "C:\\MCP\\setup-helper.mjs",
      port: 34200,
    });
    expect(rendered.startScript).toContain(
      "'C:\\Program Files\\Node''s $x\\node.exe'",
    );
    expect(rendered.startScript).toContain("& $nodePath $cliPath start");
    expect(rendered.startScript).toContain("probe-config $configPath");
    expect(rendered.startScript).toContain("FOUNDRY_MCP_PORT = '34200'");
    expect(rendered.startScript).toContain(
      "$ErrorActionPreference = 'Continue'",
    );
    expect(rendered.statusScript).toContain("$statusExitCode = $LASTEXITCODE");
    expect(rendered.startScript).not.toContain("Invoke-Expression");
    expect(rendered.clientConfig.mcpServers["foundry-vtt"]).toEqual({
      command: paths.nodePath,
      args: [paths.cliPath, "mcp"],
      env: { FOUNDRY_MCP_CONFIG_DIR: paths.configDir },
    });
    expect(rendered.codexConfig).toContain("[mcp_servers.foundry-vtt.env]");
    expect(rendered.codexConfig).toContain("tool_timeout_sec = 330");
    expect(() =>
      renderArtifacts({ ...paths, cliPath: "C:\\x\\a\nInvoke-Expression" }),
    ).toThrow();
  });

  it("keeps the token in the dedicated pairing file only and returns artifact paths", () => {
    const { config, dir } = fixture();
    const outputDir = path.join(dir, "artifacts");
    const result = writeArtifacts({
      nodePath: "C:\\Nœde\\node.exe",
      cliPath: "C:\\MCP\\cli.js",
      configDir: dir,
      outputDir,
    });
    const publicFiles = [
      result.files.startScript,
      result.files.statusScript,
      result.files.clientConfig,
      result.files.codexConfig,
    ];
    for (const file of publicFiles)
      expect(fs.readFileSync(file, "utf8")).not.toContain(config.token);
    for (const file of [result.files.startScript, result.files.statusScript]) {
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(bytes.toString("utf8")).toContain("C:\\Nœde\\node.exe");
    }
    expect(
      fs.readFileSync(result.files.clientConfig).subarray(0, 3),
    ).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(
      JSON.parse(fs.readFileSync(result.files.clientConfig, "utf8")),
    ).toBeTruthy();
    expect(
      fs.readFileSync(result.files.codexConfig).subarray(0, 3),
    ).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(fs.readFileSync(result.files.pairingInstructions, "utf8")).toContain(
      config.token,
    );
    expect(JSON.stringify(result)).not.toContain(config.token);
    expect(showPairing(path.join(dir, "config.json"))).toEqual({
      origin: config.origin,
      port: 31415,
      endpoint: "wss://127.0.0.1:31415/bridge",
      token: config.token,
    });
  });

  it("probes an authenticated read-only status request and preserves config", async () => {
    const { config, configPath } = fixture();
    const server = https.createServer(
      {
        cert: fs.readFileSync(config.certPath),
        key: fs.readFileSync(config.keyPath),
      },
      (req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          if (req.headers.authorization !== `Bearer ${config.token}`) {
            res.writeHead(401).end("{}");
            return;
          }
          if (JSON.parse(body).tool !== "get_status") {
            res.writeHead(400).end("{}");
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, data: { connected: false } }));
        });
      },
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    config.port = (server.address() as { port: number }).port;
    fs.writeFileSync(configPath, JSON.stringify(config));
    const before = fs.readFileSync(configPath, "utf8");
    try {
      expect(await probeConfig(configPath)).toEqual({
        running: true,
        paired: false,
        port: config.port,
      });
      expect(fs.readFileSync(configPath, "utf8")).toBe(before);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects unauthorized and foreign probe responses instead of treating them as stopped", async () => {
    const { config, configPath } = fixture();
    for (const response of [
      { status: 401, body: "{}" },
      { status: 200, body: JSON.stringify({ connected: false }) },
    ]) {
      const server = https.createServer(
        {
          cert: fs.readFileSync(config.certPath),
          key: fs.readFileSync(config.keyPath),
        },
        (_req, res) => res.writeHead(response.status).end(response.body),
      );
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      config.port = (server.address() as { port: number }).port;
      fs.writeFileSync(configPath, JSON.stringify(config));
      try {
        await expect(probeConfig(configPath)).rejects.toThrow();
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  it("reports a closed loopback port as not running", async () => {
    const { config, configPath } = fixture();
    const server = https.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    config.port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    fs.writeFileSync(configPath, JSON.stringify(config));
    expect(await probeConfig(configPath)).toEqual({
      running: false,
      port: config.port,
    });
  });
});
