import https from "node:https";
import type http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import companionPackage from "../package.json";
import { WebSocketServer, WebSocket } from "ws";
import {
  MAX_MESSAGE_BYTES,
  APPROVAL_TIMEOUT_MS,
  parseTool,
  writeTools,
  failure,
  diagnoseRuntimeVersions,
  type BridgeIdentity,
  type BridgeRequest,
  type ToolName,
} from "@foundry-mcp/shared";
import { prepareUploadAsset } from "./assets.js";

export type CompanionConfig = {
  origin: string;
  token: string;
  certPath: string;
  keyPath: string;
  caPath?: string;
  port?: number;
};
type Pending = {
  resolve: (v: unknown) => void;
  timer: NodeJS.Timeout;
  tool: ToolName;
  releaseUpload?: () => void;
};
type Client = { id: string; ws: WebSocket; identity: BridgeIdentity };
const validResult = (x: any) =>
  x &&
  typeof x === "object" &&
  typeof x.ok === "boolean" &&
  (x.ok === true ||
    (x.ok === false &&
      typeof x.error?.code === "string" &&
      typeof x.error?.message === "string"));
const validIdentity = (x: any): x is BridgeIdentity =>
  x &&
  typeof x.worldId === "string" &&
  typeof x.userId === "string" &&
  typeof x.foundryVersion === "string" &&
  typeof x.systemId === "string" &&
  typeof x.systemVersion === "string";
function withCompanionVersion(result: any): any {
  if (!result || result.ok !== true || !result.data) return result;
  const current = result.data.versionDiagnostics?.versions ?? {};
  return {
    ...result,
    data: {
      ...result.data,
      versionDiagnostics: diagnoseRuntimeVersions({
        compiledModule: current.compiledModule ?? null,
        installedModuleManifest: current.installedModuleManifest ?? null,
        runningCompanion: companionPackage.version,
        mcpClient: current.mcpClient ?? null,
        mcpServer: current.mcpServer ?? null,
      }),
    },
  };
}
export class CompanionDaemon {
  private server?: https.Server;
  private wss?: WebSocketServer;
  private browser?: Client;
  private pending = new Map<string, Pending>();
  private seen = new Set<string>();
  private inFlightIds = new Set<string>();
  private assetsOutstanding = 0;
  private startedAt = 0;
  private boundPort = 0;
  private heartbeat?: NodeJS.Timeout;
  private readonly origin: string;
  constructor(private config: CompanionConfig) {
    this.origin = new URL(config.origin).origin;
    if (!config.caPath)
      throw new Error(
        "A trusted CA certificate is required; configure caPath from mkcert -CAROOT.",
      );
  }
  async start(): Promise<void> {
    if (this.server) return;
    this.startedAt = Date.now();
    this.server = https.createServer(
      {
        cert: fs.readFileSync(this.config.certPath),
        key: fs.readFileSync(this.config.keyPath),
        ...(this.config.caPath
          ? { ca: fs.readFileSync(this.config.caPath) }
          : {}),
      },
      (req, res) => {
        res.setHeader("content-type", "application/json");
        if (!this.validHost(req.headers.host)) {
          res.writeHead(403).end(JSON.stringify({ error: "host rejected" }));
          return;
        }
        res.setHeader("access-control-allow-origin", this.origin);
        res.setHeader("vary", "Origin");
        res.setHeader(
          "access-control-allow-headers",
          "content-type,authorization",
        );
        if (req.headers.origin && req.headers.origin !== this.origin) {
          res.writeHead(403).end(JSON.stringify({ error: "origin rejected" }));
          return;
        }
        if (req.method === "OPTIONS") {
          res.writeHead(204).end();
          return;
        }
        if (req.method !== "POST" || req.url !== "/rpc") {
          res.writeHead(404).end("{}");
          return;
        }
        const auth = Buffer.from(req.headers.authorization ?? "");
        const expected = Buffer.from(`Bearer ${this.config.token}`);
        if (
          auth.length !== expected.length ||
          !crypto.timingSafeEqual(auth, expected)
        ) {
          res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        void this.handleRpc(req, res);
      },
    );
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_MESSAGE_BYTES,
    });
    this.server.requestTimeout = 320_000;
    this.server.headersTimeout = 15_000;
    this.server.on("upgrade", (req, socket, head) => {
      if (
        !this.validHost(req.headers.host) ||
        req.url !== "/bridge" ||
        req.headers.origin !== this.origin
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) =>
        this.wss!.emit("connection", ws, req),
      );
    });
    this.wss.on("connection", (ws) => this.acceptBrowser(ws));
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss?.clients ?? []) {
        const socket = ws as WebSocket & { isAlive?: boolean };
        if (socket.isAlive === false) {
          ws.terminate();
          continue;
        }
        socket.isAlive = false;
        ws.ping();
      }
    }, 30_000);
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(this.config.port ?? 31415, "127.0.0.1", () => {
          this.boundPort = (this.server!.address() as any).port;
          resolve();
        });
      });
    } catch (error) {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      for (const ws of this.wss?.clients ?? []) ws.terminate();
      this.wss?.close();
      this.wss = undefined;
      const server = this.server;
      this.server = undefined;
      server?.close();
      throw error;
    }
  }
  private validHost(host: string | undefined) {
    const port = this.boundPort || (this.config.port ?? 31415);
    return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
  }
  private acceptBrowser(ws: WebSocket) {
    let paired = false;
    const handshake = setTimeout(() => {
      if (!paired) ws.close(1008, "hello timeout");
    }, 5000);
    ws.on("error", () => {});
    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });
    ws.on("close", () => clearTimeout(handshake));
    ws.on("message", (raw) => {
      if (Buffer.byteLength(raw as any) > MAX_MESSAGE_BYTES) {
        ws.close(1009, "too large");
        return;
      }
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        ws.close(1003, "invalid JSON");
        return;
      }
      if (!paired) {
        if (
          this.browser ||
          m?.type !== "hello" ||
          typeof m.token !== "string" ||
          !validIdentity(m.identity)
        ) {
          ws.close(1008, "pairing rejected");
          return;
        }
        const a = Buffer.from(m.token),
          b = Buffer.from(this.config.token);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          ws.close(1008, "invalid pairing token");
          return;
        }
        paired = true;
        clearTimeout(handshake);
        const id = crypto.randomUUID();
        this.seen.clear();
        this.browser = { id, ws, identity: m.identity };
        ws.send(JSON.stringify({ type: "paired", sessionId: id }));
        return;
      }
      const p = this.pending.get(m?.id);
      if (!p || m?.type !== "response") return;
      if (!validResult(m.result)) {
        ws.close(1008, "invalid response");
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.releaseUpload?.();
      p.resolve(m.result);
    });
    ws.on("close", () => {
      if (this.browser?.ws === ws) {
        this.browser = undefined;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.releaseUpload?.();
          p.resolve({
            ok: false,
            error: {
              code: writeTools.has(p.tool) ? "OUTCOME_UNKNOWN" : "DISCONNECTED",
              message: writeTools.has(p.tool)
                ? "Connection lost while the write was pending. Check Foundry before retrying."
                : "Foundry browser disconnected.",
            },
          });
          this.pending.delete(id);
        }
      }
    });
  }
  private async handleRpc(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const chunks: Buffer[] = [];
      let n = 0;
      for await (const c of req) {
        n += c.length;
        if (n > MAX_MESSAGE_BYTES) {
          res
            .writeHead(413)
            .end(JSON.stringify({ error: "request too large" }));
          return;
        }
        chunks.push(c);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
        res
          .writeHead(415)
          .end(JSON.stringify({ error: "application/json required" }));
        return;
      }
      if (
        typeof body?.id !== "string" ||
        body.id.length > 128 ||
        typeof body.tool !== "string"
      ) {
        res.writeHead(400).end(JSON.stringify({ error: "invalid request" }));
        return;
      }
      if (this.seen.has(body.id) || this.inFlightIds.has(body.id)) {
        res.writeHead(409).end(
          JSON.stringify({
            error: "duplicate request id; request was not replayed",
          }),
        );
        return;
      }
      const parsed = parseTool(body.tool, body.args);
      if (parsed.tool === "get_status" && !this.browser) {
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              connected: false,
              identity: null,
              sessionId: null,
              uptimeMs: Date.now() - this.startedAt,
              versionDiagnostics: diagnoseRuntimeVersions({
                compiledModule: null,
                installedModuleManifest: null,
                runningCompanion: companionPackage.version,
                mcpClient: null,
                mcpServer: null,
              }),
            },
          }),
        );
        return;
      }
      if (this.seen.size >= 5000) {
        res
          .writeHead(429)
          .end(JSON.stringify({ error: "session request capacity reached" }));
        return;
      }
      if (this.pending.size + this.inFlightIds.size >= 100) {
        res
          .writeHead(429)
          .end(JSON.stringify({ error: "too many pending requests" }));
        return;
      }
      if (!this.browser) {
        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "DISCONNECTED",
              message: "Open the GM Foundry browser and connect the module.",
            },
          }),
        );
        return;
      }
      const browser = this.browser;
      if (parsed.tool === "upload_asset" && this.assetsOutstanding >= 4) {
        res.writeHead(429).end(
          JSON.stringify({
            error: "too many asset uploads are being prepared",
          }),
        );
        return;
      }
      this.inFlightIds.add(body.id);
      let uploadReserved = parsed.tool === "upload_asset";
      if (uploadReserved) this.assetsOutstanding++;
      const releaseUpload = () => {
        if (!uploadReserved) return;
        uploadReserved = false;
        this.assetsOutstanding--;
      };
      let dispatchArgs: Record<string, unknown>;
      try {
        if (parsed.tool === "upload_asset") {
          dispatchArgs = await prepareUploadAsset(parsed.args);
        } else {
          dispatchArgs = parsed.args;
        }
      } catch (error) {
        this.inFlightIds.delete(body.id);
        releaseUpload();
        throw error;
      }
      if (
        this.browser !== browser ||
        browser.ws.readyState !== WebSocket.OPEN
      ) {
        this.inFlightIds.delete(body.id);
        releaseUpload();
        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "DISCONNECTED",
              message:
                "Foundry connection changed while preparing the request; retry after reconnecting.",
            },
          }),
        );
        return;
      }
      this.seen.add(body.id);
      this.inFlightIds.delete(body.id);
      const id = crypto.randomUUID();
      const result = await new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          releaseUpload();
          resolve({
            ok: false,
            error: {
              code: writeTools.has(parsed.tool) ? "OUTCOME_UNKNOWN" : "TIMEOUT",
              message: writeTools.has(parsed.tool)
                ? "No response before timeout. Check Foundry before retrying."
                : "Request timed out.",
            },
          });
        }, APPROVAL_TIMEOUT_MS + 15000);
        this.pending.set(id, {
          resolve,
          timer,
          tool: parsed.tool,
          releaseUpload:
            parsed.tool === "upload_asset" ? releaseUpload : undefined,
        });
        this.browser!.ws.send(
          JSON.stringify({
            type: "request",
            id,
            tool: parsed.tool,
            args: dispatchArgs,
          } satisfies BridgeRequest),
          (e) => {
            if (e) {
              clearTimeout(timer);
              this.pending.delete(id);
              releaseUpload();
              resolve({
                ok: false,
                error: {
                  code: "DISCONNECTED",
                  message: "Could not send request to Foundry.",
                },
              });
            }
          },
        );
      });
      res.end(
        JSON.stringify(
          parsed.tool === "get_status" ? withCompanionVersion(result) : result,
        ),
      );
    } catch (e) {
      res.writeHead(400).end(
        JSON.stringify({
          error: e instanceof Error ? e.message : "invalid request",
        }),
      );
    }
  }
  async stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.releaseUpload?.();
      const write = writeTools.has(p.tool);
      p.resolve(
        failure(
          write ? "OUTCOME_UNKNOWN" : "DISCONNECTED",
          write
            ? "Companion stopped while a write was pending. Check Foundry before retrying."
            : "Companion stopped.",
        ),
      );
    }
    this.pending.clear();
    for (const ws of this.wss?.clients ?? []) ws.terminate();
    this.browser = undefined;
    this.wss?.close();
    await new Promise<void>((r) => this.server?.close(() => r()) ?? r());
    this.server = undefined;
  }
  address() {
    return this.server?.address();
  }
}
