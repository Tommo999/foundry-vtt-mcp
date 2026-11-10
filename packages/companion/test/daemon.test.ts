import companionPackage from "../package.json";
import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import WebSocket from "ws";
import crypto from "node:crypto";
import { CompanionDaemon } from "../src/daemon.js";

let dir: string,
  cert: string,
  key: string,
  daemon: CompanionDaemon,
  port: number;
const origin = "https://foundry.test";
const token = "test-pairing-token-which-is-long-enough";
const identity = {
  worldId: "world",
  userId: "gm",
  foundryVersion: "14.1",
  systemId: "test",
  systemVersion: "1",
};
function rpc(
  body: unknown,
  auth = token,
  reqOrigin = origin,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = https.request(
      {
        hostname: "127.0.0.1",
        servername: "localhost",
        port,
        path: "/rpc",
        method: "POST",
        ca: fs.readFileSync(cert),
        headers: {
          authorization: `Bearer ${auth}`,
          "content-type": "application/json",
          origin: reqOrigin,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let parsed: any;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode!, data: parsed });
        });
      },
    );
    r.on("error", reject);
    r.end(data);
  });
}
async function connect(pairing = token, wsOrigin = origin) {
  return new Promise<{ ws: WebSocket; session: string; version: string }>(
    (resolve, reject) => {
      const ws = new WebSocket(`wss://localhost:${port}/bridge`, {
        ca: fs.readFileSync(cert),
        origin: wsOrigin,
      });
      ws.once("error", reject);
      ws.once("close", () => reject(new Error("pairing rejected")));
      ws.once("open", () =>
        ws.send(JSON.stringify({ type: "hello", token: pairing, identity })),
      );
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "paired")
          resolve({
            ws,
            session: m.sessionId,
            version: m.runningCompanionVersion,
          });
      });
    },
  );
}
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-mcp-"));
  cert = path.join(dir, "cert.pem");
  key = path.join(dir, "key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "pipe" },
  );
});
afterEach(async () => {
  await daemon?.stop();
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
describe("CompanionDaemon", () => {
  it("captures the daemon companion version in the paired handshake", async () => {
    daemon = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await daemon.start();
    port = (daemon.address() as any).port;
    const client = await connect();
    expect(client.version).toBe(companionPackage.version);
    client.ws.close();
  });
  it("cleans up resources when its port is already occupied", async () => {
    const first = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await first.start();
    const occupiedPort = (first.address() as any).port as number;
    const second = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: occupiedPort,
    });

    await expect(second.start()).rejects.toThrow();
    await first.stop();

    await expect(second.start()).resolves.toBeUndefined();
    await second.stop();
  });
  it("rejects unauthorized token and origin", async () => {
    daemon = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await daemon.start();
    port = (daemon.address() as any).port;
    expect(
      (await rpc({ id: "x", tool: "get_status", args: {} }, "bad")).status,
    ).toBe(401);
    expect(
      (
        await rpc(
          { id: "x", tool: "get_status", args: {} },
          token,
          "https://evil.test",
        )
      ).status,
    ).toBe(403);
  });
  it("reads a local PNG and forwards only validated base64 bytes", async () => {
    daemon = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await daemon.start();
    port = (daemon.address() as any).port;
    const imagePath = path.join(dir, "map.png");
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    fs.writeFileSync(imagePath, png);
    const { ws } = await connect();
    const resultPromise = rpc({
      id: "asset-local-path",
      tool: "upload_asset",
      args: {
        filename: "map.png",
        mimeType: "image/png",
        localPath: imagePath,
        directory: "maps",
      },
    });
    const request = await new Promise<any>((resolve) =>
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString()))),
    );
    expect(request.tool).toBe("upload_asset");
    expect(request.args.localPath).toBeUndefined();
    expect(request.args.dataBase64).toBe(png.toString("base64"));
    ws.send(
      JSON.stringify({
        type: "response",
        id: request.id,
        result: { ok: true, data: { path: "maps/map.png" } },
      }),
    );
    expect((await resultPromise).data.ok).toBe(true);
    ws.close();
  });
  it("limits pending uploads to four until the GM answers", async () => {
    daemon = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await daemon.start();
    port = (daemon.address() as any).port;
    const imagePath = path.join(dir, "queued.png");
    fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const { ws } = await connect();
    let resolveRequests!: (requests: any[]) => void;
    const requestsPromise = new Promise<any[]>((resolve) => {
      resolveRequests = resolve;
    });
    const requests: any[] = [];
    const collectRequest = (raw: WebSocket.RawData) => {
      requests.push(JSON.parse(raw.toString()));
      if (requests.length === 4) resolveRequests(requests);
    };
    ws.on("message", collectRequest);
    const calls = Array.from({ length: 4 }, (_, index) =>
      rpc({
        id: "asset-queued-" + index,
        tool: "upload_asset",
        args: {
          filename: "queued.png",
          mimeType: "image/png",
          localPath: imagePath,
        },
      }),
    );
    try {
      await requestsPromise;
      expect(
        (
          await rpc({
            id: "asset-queued-fifth",
            tool: "upload_asset",
            args: {
              filename: "queued.png",
              mimeType: "image/png",
              localPath: imagePath,
            },
          })
        ).status,
      ).toBe(429);
      for (const request of requests) {
        ws.send(
          JSON.stringify({
            type: "response",
            id: request.id,
            result: { ok: true, data: {} },
          }),
        );
      }
      expect((await Promise.all(calls)).map((result) => result.status)).toEqual(
        [200, 200, 200, 200],
      );
    } finally {
      ws.off("message", collectRequest);
      ws.close();
      await Promise.allSettled(calls);
    }
  });

  it("rejects upload requests with missing or conflicting sources", async () => {
    daemon = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await daemon.start();
    port = (daemon.address() as any).port;
    const base = { filename: "map.png", mimeType: "image/png" };
    expect(
      (await rpc({ id: "asset-no-source", tool: "upload_asset", args: base }))
        .status,
    ).toBe(400);
    expect(
      (
        await rpc({
          id: "asset-two-sources",
          tool: "upload_asset",
          args: { ...base, dataBase64: "AA==", localPath: "/tmp/map.png" },
        })
      ).status,
    ).toBe(400);
  });
  it("reports offline status and exchanges a paired tool request", async () => {
    daemon = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await daemon.start();
    port = (daemon.address() as any).port;
    const offline = await rpc({
      id: crypto.randomUUID(),
      tool: "get_status",
      args: {},
    });
    expect(offline.data.data.connected).toBe(false);
    expect(offline.data.data.versionDiagnostics.versions.runningCompanion).toBe(
      companionPackage.version,
    );
    expect(offline.data.data.versionDiagnostics.unverified).toContain(
      "compiledModule",
    );
    const { ws } = await connect();
    const call = rpc({ id: "request-1", tool: "get_status", args: {} });
    const request = await new Promise<any>((resolve) =>
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString()))),
    );
    expect(request.tool).toBe("get_status");
    ws.send(
      JSON.stringify({
        type: "response",
        id: request.id,
        result: { ok: true, data: { connected: true } },
      }),
    );
    const connected = await call;
    expect(connected.data.data.connected).toBe(true);
    expect(
      connected.data.data.versionDiagnostics.versions.runningCompanion,
    ).toBe(companionPackage.version);
    ws.close();
  });
  it("rejects wrong pairing token", async () => {
    daemon = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await daemon.start();
    port = (daemon.address() as any).port;
    await expect(connect("wrong")).rejects.toBeTruthy();
  });
  it("rejects duplicate IDs without replay and reports uncertain writes on disconnect", async () => {
    daemon = new CompanionDaemon({
      origin,
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port: 0,
    });
    await daemon.start();
    port = (daemon.address() as any).port;
    const { ws } = await connect();
    const pending = rpc({
      id: "write-once",
      tool: "create_document",
      args: { documentType: "Actor", data: { name: "A" } },
    });
    await new Promise<void>((resolve) => ws.once("message", () => resolve()));
    expect(
      (
        await rpc({
          id: "write-once",
          tool: "create_document",
          args: { documentType: "Actor", data: { name: "A" } },
        })
      ).status,
    ).toBe(409);
    ws.close();
    const result = (await pending).data;
    expect(result.error.code).toBe("OUTCOME_UNKNOWN");
  });
});
