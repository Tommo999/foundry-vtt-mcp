import DOMPurify from "dompurify";
import { sanitizeData, validateObject } from "./security";
import { handlePF2eRead, pf2eStatus } from "./pf2e";
import { handlePF2eWrite } from "./pf2e-writes";
import { handlePF2eConditions } from "./pf2e-conditions";
import { handlePF2eInventory } from "./pf2e-inventory";
import { handleEncounters } from "./encounters";
import { handleSessionSnapshot } from "./session-snapshot";
import { handlePF2eChecks } from "./pf2e-checks";
import { handlePF2eStrikes } from "./pf2e-strikes";
import { handlePF2eCombatContext } from "./pf2e-combat-context";
import { handlePF2eInspectDamageApplication } from "./pf2e-damage-context";
import { handlePF2eApplyDamage } from "./pf2e-damage-application";
import type { BridgeContext } from "./bridge-context";
import type { PF2eContext } from "./pf2e-context";
import {
  canonicalRelativePath,
  decodeImageBase64,
  validateImageFilename,
} from "./assets";
import {
  APPROVAL_TIMEOUT_MS,
  documentTypes,
  embeddedTypes,
  failure,
  MAX_MESSAGE_BYTES,
  MAX_ASSET_BYTES,
  parseTool,
  toolNames,
  writeTools,
  type BridgeIdentity,
  type BridgeRequest,
  type ToolName,
  type ToolResult,
} from "@foundry-mcp/shared";

const MODULE_ID = "foundry-vtt-mcp";
type Pending = {
  request: BridgeRequest;
  timer: number;
  socket: WebSocket;
  identity: BridgeIdentity;
};
type Runtime = {
  socket?: WebSocket;
  endpoint: string;
  token: string;
  autoWrites: boolean;
  sessionId?: string;
  worldId?: string;
  userId?: string;
  queue: Map<string, Pending>;
  seen: Set<string>;
  history: Array<{ id: string; tool: string; outcome: string; at: string }>;
  app?: BridgeApp;
};
const runtime: Runtime = {
  endpoint: "wss://127.0.0.1:31415/bridge",
  token: "",
  autoWrites: false,
  queue: new Map(),
  seen: new Set(),
  history: [],
};
const g = globalThis as any;
const gameRef = () => g.game;
function identity(): BridgeIdentity {
  const game = gameRef();
  return {
    worldId: String(game?.world?.id ?? ""),
    userId: String(game?.user?.id ?? ""),
    foundryVersion: String(game?.version ?? ""),
    systemId: String(game?.system?.id ?? ""),
    systemVersion: String(game?.system?.version ?? ""),
  };
}
function gm(): boolean {
  return Boolean(gameRef()?.user?.isGM);
}
function notify(text: string, kind: "info" | "warn" | "error" = "info") {
  const n = g.ui?.notifications;
  n?.[kind]?.(text);
}
function safeUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.protocol !== "wss:"
  )
    throw new Error("Use secure WSS on a loopback address.");
  if (url.username || url.password || url.hash)
    throw new Error("Endpoint cannot contain credentials or a fragment.");
  return url;
}
function serialize(doc: any): any {
  if (!doc) return null;
  const raw = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    ...JSON.parse(JSON.stringify(raw)),
    uuid: doc.uuid ?? undefined,
    documentName: doc.documentName ?? undefined,
  };
}
function typeClass(type: string): any {
  const config = g.CONFIG?.[type];
  return (
    config?.documentClass ??
    (
      {
        Actor: g.Actor,
        Item: g.Item,
        JournalEntry: g.JournalEntry,
        Scene: g.Scene,
      } as any
    )[type]
  );
}
function collection(type: string): any {
  return gameRef()?.[
    (
      {
        Actor: "actors",
        Item: "items",
        JournalEntry: "journal",
        Scene: "scenes",
      } as any
    )[type]
  ];
}
function searchableText(value: string): string {
  const sanitized = DOMPurify.sanitize(value);
  return (
    new DOMParser().parseFromString(sanitized, "text/html").body.textContent ??
    ""
  );
}
function typeSchema(type: string): any {
  const cls = typeClass(type);
  const schema = cls?.schema?.fields ?? cls?.schema;
  const models =
    type === "Actor"
      ? g.CONFIG?.Actor?.dataModels
      : type === "Item"
        ? g.CONFIG?.Item?.dataModels
        : undefined;
  return {
    documentType: type,
    types: cls?.TYPES ?? [],
    fields: schema ? Object.keys(schema) : [],
    subtypes: Object.fromEntries(
      Object.entries(models ?? {}).map(([name, model]: any) => [
        name,
        Object.keys(model?.schema?.fields ?? {}),
      ]),
    ),
  };
}
function currentPack(): any {
  return gameRef()?.packs;
}
function sanitizeImported(
  input: any,
  documentType: string,
): Record<string, unknown> {
  const fields: Record<string, string[]> = {
    Actor: ["name", "type", "img", "system", "prototypeToken", "sort", "items"],
    Item: ["name", "type", "img", "system", "sort"],
    JournalEntry: ["name", "img", "sort", "pages"],
    Scene: [
      "name",
      "img",
      "width",
      "height",
      "padding",
      "background",
      "grid",
      "initial",
      "darkness",
      "tokenVision",
      "fog",
      "globalLight",
      "environment",
      "sort",
      "tokens",
    ],
    JournalEntryPage: ["name", "type", "text", "src", "system", "sort"],
    Token: [
      "name",
      "x",
      "y",
      "width",
      "height",
      "rotation",
      "elevation",
      "texture",
      "actorId",
      "actorLink",
      "disposition",
      "hidden",
      "locked",
      "alpha",
      "bar1",
      "bar2",
      "sight",
      "detectionModes",
      "light",
    ],
  };
  const result: Record<string, unknown> = {};
  for (const key of fields[documentType] ?? []) {
    if (!(key in (input ?? {}))) continue;
    const value = (input as any)[key];
    if (key === "items" && documentType === "Actor" && Array.isArray(value)) {
      result.items = value.map((item: any) => sanitizeImported(item, "Item"));
      continue;
    }
    if (
      key === "pages" &&
      documentType === "JournalEntry" &&
      Array.isArray(value)
    ) {
      result.pages = value.map((page: any) =>
        sanitizeImported(page, "JournalEntryPage"),
      );
      continue;
    }
    if (key === "tokens" && documentType === "Scene" && Array.isArray(value)) {
      result.tokens = value.map((token: any) =>
        sanitizeImported(token, "Token"),
      );
      continue;
    }
    if (
      key === "text" &&
      documentType === "JournalEntryPage" &&
      value &&
      typeof value === "object"
    ) {
      const text = { ...(value as any) };
      if (typeof text.content === "string")
        text.content = DOMPurify.sanitize(text.content);
      result.text = text;
      continue;
    }
    if (
      key === "prototypeToken" &&
      documentType === "Actor" &&
      value &&
      typeof value === "object"
    ) {
      result.prototypeToken = sanitizeImported(value, "Token");
      continue;
    }
    if (
      [
        "system",
        "prototypeToken",
        "grid",
        "background",
        "initial",
        "environment",
        "texture",
        "bar1",
        "bar2",
        "sight",
        "detectionModes",
        "light",
      ].includes(key)
    ) {
      validateObject(value);
      result[key] = value;
      continue;
    }
    result[key] = value;
  }
  const childFields: Record<string, unknown> = {};
  for (const key of ["items", "pages", "tokens"])
    if (key in result) {
      childFields[key] = result[key];
      delete result[key];
    }
  return { ...sanitizeWrite(result, documentType), ...childFields };
}
function sanitizeWrite(
  input: Record<string, unknown>,
  documentType?: string,
): Record<string, unknown> {
  const data = sanitizeData(input);
  if (documentType === "JournalEntryPage") {
    if (typeof data["text.content"] === "string")
      data["text.content"] = DOMPurify.sanitize(data["text.content"] as string);
    if (data.text && typeof data.text === "object") {
      const text = data.text as Record<string, unknown>;
      if (typeof text.content === "string")
        text.content = DOMPurify.sanitize(text.content);
    }
  }
  const allowed: Record<string, Set<string>> = {
    Actor: new Set(["name", "type", "img", "system", "prototypeToken", "sort"]),
    Item: new Set(["name", "type", "img", "system", "sort", "effects"]),
    JournalEntry: new Set(["name", "img", "sort", "ownership"]),
    Scene: new Set([
      "name",
      "img",
      "width",
      "height",
      "padding",
      "background",
      "grid",
      "initial",
      "darkness",
      "tokenVision",
      "fog",
      "globalLight",
      "environment",
      "sort",
    ]),
    JournalEntryPage: new Set([
      "name",
      "type",
      "text",
      "src",
      "system",
      "sort",
    ]),
    Token: new Set([
      "name",
      "x",
      "y",
      "width",
      "height",
      "rotation",
      "elevation",
      "texture",
      "actorId",
      "actorLink",
      "disposition",
      "hidden",
      "locked",
      "alpha",
      "bar1",
      "bar2",
      "sight",
      "detectionModes",
      "light",
    ]),
  };
  if (documentType && allowed[documentType])
    for (const key of Object.keys(data))
      if (!allowed[documentType].has(key.split(".")[0]))
        throw new Error(`Field is not supported for ${documentType}: ${key}`);
  return data;
}
async function lookup(uuid: string): Promise<any> {
  const doc = await g.fromUuid?.(uuid);
  if (!doc)
    throw Object.assign(new Error(`Document not found: ${uuid}`), {
      code: "NOT_FOUND",
    });
  return doc;
}
function pf2eContext(
  session: BridgeIdentity,
  socket: WebSocket,
  authorization: "approved" | "automatic",
): PF2eContext {
  const bridge = bridgeContext(session, socket, authorization);
  const game = bridge.game;
  return {
    game,
    resolve: bridge.resolve,
    serialize: bridge.serialize,
    assertWrite() {
      bridge.assertWrite();
      if (gameRef()?.system?.id !== "pf2e")
        throw Object.assign(
          new Error("This tool requires the PF2e game system."),
          { code: "PF2E_UNAVAILABLE" },
        );
      if (gameRef()?.settings?.get?.(MODULE_ID, "pf2eEnabled") === false)
        throw Object.assign(
          new Error("PF2e support is disabled in module settings."),
          { code: "PF2E_UNAVAILABLE" },
        );
    },
  };
}
function bridgeContext(
  session: BridgeIdentity,
  socket: WebSocket,
  authorization: "approved" | "automatic",
): BridgeContext {
  return {
    game: gameRef(),
    resolve: lookup,
    serialize,
    assertWrite() {
      if (!validSession(session, socket) || !gm())
        throw Object.assign(new Error("GM session changed before write."), {
          code: "SESSION_CHANGED",
        });
      if (authorization === "automatic" && !runtime.autoWrites)
        throw Object.assign(
          new Error("Automatic write authorization changed before operation."),
          { code: "SESSION_CHANGED" },
        );
    },
  };
}
async function execute(
  tool: ToolName,
  args: Record<string, unknown>,
  session = identity(),
  socket = runtime.socket,
  authorization: "approved" | "automatic" = "approved",
): Promise<ToolResult> {
  try {
    const game = gameRef();
    if (!socket || !validSession(session, socket))
      return failure("SESSION_CHANGED", "GM session changed before operation.");
    switch (tool) {
      case "get_status":
        return {
          ok: true,
          data: {
            connected: runtime.socket?.readyState === WebSocket.OPEN,
            world: game.world?.title,
            worldId: game.world?.id,
            systemId: game.system?.id,
            systemVersion: game.system?.version,
            foundryVersion: game.version,
            capabilities: {
              encounterPreparation: Boolean(
                game.combats?.documentClass?.create &&
                game.combats?.documentClass?.prototype?.createEmbeddedDocuments,
              ),
              encounterExecution: Boolean(
                game.combats?.documentClass?.prototype?.activate &&
                game.combats?.documentClass?.prototype?.startCombat &&
                game.combats?.documentClass?.prototype?.nextTurn,
              ),
              sessionSnapshot: true,
            },
            writeMode: runtime.autoWrites ? "automatic" : "approval",
            recentOutcomes: runtime.history.slice(-20),
            assetRoot:
              game.settings.get(MODULE_ID, "assetRoot") || "assets/foundry-mcp",
            maxAssetBytes: MAX_ASSET_BYTES,
            pf2eAdapter: (() => {
              const status = pf2eStatus(
                pf2eContext(session, socket!, authorization),
              ) as Record<string, any>;
              return {
                ...status,
                tools: {
                  conditionsAndEffects: status.available,
                  inventory: status.available,
                  checksAndActions: status.available,
                  combatContext: status.available,
                  strikesAndDamage: status.available,
                  damageApplication: status.available,
                  initiative:
                    status.available &&
                    Boolean(
                      game.combats?.documentClass?.prototype?.rollInitiative,
                    ),
                },
                note: "Individual actor and native API support is checked when each PF2e tool runs.",
              };
            })(),
          },
        };
      case "pf2e_roll_check":
      case "pf2e_inspect_actions": {
        const data = await handlePF2eChecks(
          tool,
          args,
          pf2eContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "pf2e_combat_context": {
        const data = await handlePF2eCombatContext(
          args,
          pf2eContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "pf2e_roll_strike":
      case "pf2e_roll_damage": {
        const data = await handlePF2eStrikes(
          tool,
          args,
          pf2eContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "pf2e_inspect_damage_application": {
        const data = await handlePF2eInspectDamageApplication(
          args as Parameters<typeof handlePF2eInspectDamageApplication>[0],
          pf2eContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "pf2e_apply_damage": {
        const data = await handlePF2eApplyDamage(
          args as Parameters<typeof handlePF2eApplyDamage>[0],
          pf2eContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "pf2e_status":
      case "pf2e_search_compendium":
      case "pf2e_party_summary":
      case "pf2e_analyze_encounter":
      case "pf2e_import_document":
      case "pf2e_stage_encounter": {
        const ctx = pf2eContext(session, socket!, authorization);
        const data =
          tool === "pf2e_import_document" || tool === "pf2e_stage_encounter"
            ? await handlePF2eWrite(tool, args, ctx)
            : await handlePF2eRead(tool, args, ctx);
        return { ok: true, data };
      }
      case "pf2e_inspect_conditions":
      case "pf2e_set_condition":
      case "pf2e_adjust_condition":
      case "pf2e_apply_effect":
      case "pf2e_remove_effect": {
        const data = await handlePF2eConditions(
          tool,
          args,
          pf2eContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "pf2e_inventory":
      case "pf2e_add_inventory_item":
      case "pf2e_set_item_quantity":
      case "pf2e_transfer_item":
      case "pf2e_add_coins":
      case "pf2e_create_loot": {
        const data = await handlePF2eInventory(
          tool,
          args,
          pf2eContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "list_encounters":
      case "inspect_encounter":
      case "create_encounter":
      case "add_combatants":
      case "remove_combatants": {
        const data = await handleEncounters(
          tool,
          args,
          bridgeContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "pf2e_roll_initiative":
      case "start_encounter":
      case "next_turn": {
        const ctx =
          tool === "pf2e_roll_initiative"
            ? pf2eContext(session, socket!, authorization)
            : bridgeContext(session, socket!, authorization);
        const data = await handleEncounters(tool, args, ctx);
        return { ok: true, data };
      }
      case "session_snapshot": {
        const data = await handleSessionSnapshot(
          args,
          bridgeContext(session, socket!, authorization),
        );
        return { ok: true, data };
      }
      case "discover_types": {
        const t = args.documentType as string | undefined;
        return { ok: true, data: (t ? [t] : documentTypes).map(typeSchema) };
      }
      case "search_content": {
        const query = String(args.query).toLocaleLowerCase();
        const types = args.documentType
          ? [String(args.documentType)]
          : [...documentTypes];
        const offset = Number(args.offset ?? 0),
          limit = Number(args.limit ?? 25);
        const matches: any[] = [];
        for (const type of types)
          for (const doc of Array.from(collection(type) ?? []) as any[]) {
            const raw = serialize(doc);
            const snippets: string[] = [];
            const visit = (value: any, depth = 0) => {
              if (depth > 6 || value == null) return;
              if (typeof value === "string") {
                const text = searchableText(value).replace(/\s+/g, " ").trim();
                const matchAt = text.toLocaleLowerCase().indexOf(query);
                if (matchAt >= 0)
                  snippets.push(
                    text.slice(Math.max(0, matchAt - 100), matchAt + 400),
                  );
                return;
              }
              if (Array.isArray(value)) {
                for (const item of value.slice(0, 100)) visit(item, depth + 1);
                return;
              }
              if (typeof value === "object")
                for (const [key, child] of Object.entries(value))
                  if (
                    ![
                      "flags",
                      "macros",
                      "command",
                      "ownership",
                      "permission",
                      "permissions",
                    ].includes(key)
                  )
                    visit(child, depth + 1);
            };
            visit(raw);
            if (
              String(doc.name ?? "")
                .toLocaleLowerCase()
                .includes(query) ||
              snippets.length
            )
              matches.push({
                uuid: doc.uuid,
                documentName: type,
                name: doc.name,
                snippets: snippets.slice(0, 5),
              });
          }
        return {
          ok: true,
          data: {
            total: matches.length,
            offset,
            limit,
            results: matches.slice(offset, offset + limit),
          },
        };
      }
      case "list_folders": {
        const offset = Number(args.offset ?? 0),
          limit = Number(args.limit ?? 25);
        const rows = Array.from(game.folders ?? []) as any[];
        const selected = args.documentType
          ? rows.filter((f) => f.type === args.documentType)
          : rows;
        return {
          ok: true,
          data: {
            total: selected.length,
            offset,
            limit,
            results: selected.slice(offset, offset + limit).map((f) => ({
              id: f.id,
              uuid: f.uuid,
              name: f.name,
              type: f.type,
              parentId: f.folder?.id ?? null,
              color: f.color ?? null,
            })),
          },
        };
      }
      case "browse_assets": {
        const directory = canonicalRelativePath(String(args.directory ?? ""));
        const path = directory;
        const FilePicker =
          g.foundry?.applications?.apps?.FilePicker ?? g.FilePicker;
        if (!FilePicker?.browse)
          throw new Error("Foundry FilePicker browse API is unavailable.");
        const result = await FilePicker.browse("data", path);
        const query = String(args.query ?? "").toLowerCase();
        const offset = Number(args.offset ?? 0),
          limit = Number(args.limit ?? 25);
        const directories = (result.dirs ?? []).filter((entry: string) =>
          entry.toLowerCase().includes(query),
        );
        const files = (result.files ?? []).filter(
          (file: string) =>
            /\.(png|jpe?g|webp|gif|avif)$/i.test(file) &&
            file.toLowerCase().includes(query),
        );
        return {
          ok: true,
          data: {
            directory: path || ".",
            total: files.length,
            directoryTotal: directories.length,
            offset,
            limit,
            directories: directories.slice(offset, offset + limit),
            files: files.slice(offset, offset + limit),
          },
        };
      }
      case "inspect_scene": {
        const scene = await lookup(String(args.uuid));
        if (scene.documentName !== "Scene" || scene.compendium)
          throw new Error("Target must be a Scene.");
        const summary = (key: string, mapper: (value: any) => any) => {
          const docs = Array.from(scene[key] ?? []) as any[];
          return {
            total: docs.length,
            truncated: docs.length > 100,
            items: docs.slice(0, 100).map(mapper),
          };
        };
        return {
          ok: true,
          data: {
            uuid: scene.uuid,
            name: scene.name,
            width: scene.width,
            height: scene.height,
            sceneBounds: scene.dimensions?.sceneRect ?? {
              x: 0,
              y: 0,
              width: scene.width,
              height: scene.height,
            },
            grid: {
              type: scene.grid?.type,
              size: scene.grid?.size,
              distance: scene.grid?.distance,
              units: scene.grid?.units,
            },
            background:
              scene.background?.src ?? scene.background?.texture?.src ?? null,
            counts: {
              tokens: scene.tokens?.size ?? 0,
              walls: scene.walls?.size ?? 0,
              lights: scene.lights?.size ?? 0,
              levels: scene.levels?.size ?? 0,
              notes: scene.notes?.size ?? 0,
            },
            tokens: summary("tokens", (d) => ({
              id: d.id,
              name: d.name,
              x: d.x,
              y: d.y,
              actorUuid: d.actor?.uuid ?? null,
            })),
            walls: summary("walls", (d) => ({ id: d.id, c: [...(d.c ?? [])] })),
            lights: summary("lights", (d) => ({
              id: d.id,
              x: d.x,
              y: d.y,
              bright: d.config?.bright,
              dim: d.config?.dim,
            })),
            levels: summary("levels", (d) => ({
              id: d.id,
              name: d.name,
              elevation: d.elevation,
            })),
            notes: summary("notes", (d) => ({
              id: d.id,
              x: d.x,
              y: d.y,
              entryUuid: d.entry?.uuid ?? null,
              pageId: d.pageId,
            })),
          },
        };
      }
      case "search_world": {
        const type = args.documentType as string;
        const q = String(args.query ?? "").toLocaleLowerCase();
        const offset = Number(args.offset ?? 0),
          limit = Number(args.limit ?? 25);
        const docs = Array.from(collection(type) ?? []) as any[];
        const matches = docs.filter((d) =>
          String(d.name ?? "")
            .toLocaleLowerCase()
            .includes(q),
        );
        return {
          ok: true,
          data: {
            total: matches.length,
            offset,
            limit,
            results: matches.slice(offset, offset + limit).map(serialize),
          },
        };
      }
      case "list_compendiums": {
        const packs = Array.from(currentPack() ?? []) as any[];
        const offset = Number(args.offset ?? 0),
          limit = Number(args.limit ?? 25);
        return {
          ok: true,
          data: {
            total: packs.length,
            offset,
            limit,
            results: packs.slice(offset, offset + limit).map((p) => ({
              collection: p.collection,
              title: p.title,
              documentName: p.documentName,
              locked: p.locked,
            })),
          },
        };
      }
      case "search_compendium": {
        const pack = game.packs?.get(String(args.pack));
        if (!pack)
          throw Object.assign(new Error("Compendium not found."), {
            code: "NOT_FOUND",
          });
        const index = await pack.getIndex();
        const q = String(args.query ?? "").toLocaleLowerCase();
        const offset = Number(args.offset ?? 0),
          limit = Number(args.limit ?? 25);
        const rows = Array.from(index) as any[];
        const matches = rows.filter((r) =>
          String(r.name ?? "")
            .toLocaleLowerCase()
            .includes(q),
        );
        return {
          ok: true,
          data: {
            total: matches.length,
            offset,
            limit,
            results: matches.slice(offset, offset + limit).map((row: any) => ({
              ...row,
              uuid: `Compendium.${pack.collection}.${pack.documentName}.${row._id}`,
            })),
          },
        };
      }
      case "get_document":
        return { ok: true, data: serialize(await lookup(String(args.uuid))) };
      case "create_folder": {
        const type = String(args.documentType),
          name = String(args.name).trim();
        let parent: any = null;
        if (args.parentUuid) {
          parent = await lookup(String(args.parentUuid));
          if (
            parent.documentName !== "Folder" ||
            parent.type !== type ||
            parent.compendium
          )
            throw new Error(
              "Parent folder must match the requested document type.",
            );
        }
        if (
          !validSession(session, socket!) ||
          (authorization === "automatic" && !runtime.autoWrites)
        )
          throw new Error(
            "GM session or write authorization changed before write.",
          );
        const Folder =
          g.CONFIG?.Folder?.documentClass ??
          g.foundry?.documents?.Folder ??
          g.Folder;
        if (!Folder?.create)
          throw new Error("Foundry Folder creation API is unavailable.");
        const folder = await Folder.create({
          name,
          type,
          folder: parent?.id ?? null,
          color: args.color ?? null,
        });
        return { ok: true, data: serialize(folder) };
      }
      case "move_document": {
        const doc = await lookup(String(args.uuid));
        if (!documentTypes.includes(doc.documentName) || doc.compendium)
          throw new Error(
            "Only world Actors, Items, Journals, and Scenes can be moved.",
          );
        let folder: any = null;
        if (args.folderUuid) {
          folder = await lookup(String(args.folderUuid));
          if (
            folder.documentName !== "Folder" ||
            folder.type !== doc.documentName ||
            folder.compendium
          )
            throw new Error("Destination folder type must match the document.");
        }
        if (
          !validSession(session, socket!) ||
          (authorization === "automatic" && !runtime.autoWrites)
        )
          throw new Error(
            "GM session or write authorization changed before write.",
          );
        const updated = await doc.update({ folder: folder?.id ?? null });
        return { ok: true, data: serialize(updated) };
      }
      case "upload_asset": {
        if (args.localPath !== undefined)
          throw new Error(
            "The browser module accepts only dataBase64 uploads.",
          );
        const base64 = args.dataBase64;
        if (typeof base64 !== "string")
          throw new Error("dataBase64 is required for browser uploads.");
        const mime = String(args.mimeType);
        const bytes = decodeImageBase64(base64, mime);
        const filename = validateImageFilename(String(args.filename), mime);
        const directory = canonicalRelativePath(String(args.directory ?? ""));
        const root = canonicalRelativePath(
          String(
            game.settings.get(MODULE_ID, "assetRoot") || "assets/foundry-mcp",
          ),
        );
        if (
          !root ||
          ["worlds", "systems", "modules"].includes(
            root.split("/")[0].toLowerCase(),
          )
        )
          throw new Error(
            "Asset root must stay within the configured data assets folder.",
          );
        const FilePicker =
          g.foundry?.applications?.apps?.FilePicker ?? g.FilePicker;
        if (
          !FilePicker?.upload ||
          !FilePicker?.browse ||
          !FilePicker?.createDirectory
        )
          throw new Error(
            "Foundry FilePicker browse/upload APIs are unavailable.",
          );
        let path = [root, directory].filter(Boolean).join("/");
        const parts = path.split("/");
        let cursor = "";
        for (let index = 0; index < parts.length; index++) {
          const part = parts[index];
          cursor = cursor ? `${cursor}/${part}` : part;
          const parentPath = parts.slice(0, index).join("/");
          const contents = await FilePicker.browse("data", parentPath);
          if (
            !(contents.dirs ?? []).some(
              (dir: string) => dir === cursor || dir.endsWith(`/${part}`),
            )
          ) {
            if (
              !validSession(session, socket!) ||
              (authorization === "automatic" && !runtime.autoWrites)
            )
              throw new Error(
                "GM session or write authorization changed before directory creation.",
              );
            await FilePicker.createDirectory("data", cursor);
          }
        }
        if (
          !validSession(session, socket!) ||
          (authorization === "automatic" && !runtime.autoWrites)
        )
          throw new Error(
            "GM session or write authorization changed before asset upload.",
          );
        const id =
          g.foundry?.utils?.randomID?.() ??
          crypto.randomUUID().replaceAll("-", "");
        const finalName = `${id}-${filename}`;
        const file = new File(
          [bytes.slice().buffer as ArrayBuffer],
          finalName,
          { type: mime },
        );
        const uploaded = await FilePicker.upload("data", path, file, {});
        if (!uploaded || uploaded.error || typeof uploaded.path !== "string")
          throw new Error(
            uploaded?.error ??
              "Foundry did not confirm the uploaded asset path.",
          );
        return {
          ok: true,
          data: {
            path: uploaded.path,
            filename: finalName,
            mimeType: mime,
            size: bytes.byteLength,
            maxSize: MAX_ASSET_BYTES,
          },
        };
      }
      case "add_map_note": {
        const scene = await lookup(String(args.sceneUuid));
        if (scene.documentName !== "Scene" || scene.compendium)
          throw new Error("Target must be a Scene.");
        const journal = await lookup(String(args.journalUuid));
        if (journal.documentName !== "JournalEntry" || journal.compendium)
          throw new Error("Map note must reference a world JournalEntry.");
        let page: any = null;
        if (args.pageUuid) {
          page = await lookup(String(args.pageUuid));
          if (
            page.documentName !== "JournalEntryPage" ||
            page.parent?.uuid !== journal.uuid ||
            page.compendium
          )
            throw new Error("Page must belong to the selected world journal.");
        }
        const x = Number(args.x),
          y = Number(args.y);
        const bounds = scene.dimensions?.sceneRect ?? {
          x: 0,
          y: 0,
          width: scene.width,
          height: scene.height,
        };
        if (
          x < bounds.x ||
          y < bounds.y ||
          x > bounds.x + bounds.width ||
          y > bounds.y + bounds.height
        )
          throw new Error("Map note coordinates must be within scene bounds.");
        if (
          !validSession(session, socket!) ||
          (authorization === "automatic" && !runtime.autoWrites)
        )
          throw new Error(
            "GM session or write authorization changed before write.",
          );
        if (typeof scene.createEmbeddedDocuments !== "function")
          throw new Error("Foundry Scene Note API is unavailable.");
        const created = await scene.createEmbeddedDocuments("Note", [
          {
            entryId: journal.id,
            pageId: page?.id ?? null,
            x,
            y,
            text: String(args.label ?? ""),
            texture: { src: String(args.icon ?? "icons/svg/book.svg") },
          },
        ]);
        return { ok: true, data: created.map(serialize) };
      }
      case "create_document": {
        const type = args.documentType as string;
        const data = sanitizeWrite(args.data as Record<string, unknown>, type);
        if (!typeClass(type)) throw new Error("Unsupported document type.");
        if (
          (type === "Actor" || type === "Item") &&
          data.type &&
          !typeClass(type).TYPES?.includes(data.type)
        )
          throw new Error(`Unsupported ${type} subtype.`);
        if (typeof data.name !== "string" || !data.name.trim())
          throw new Error("A non-empty name is required.");
        if (type === "JournalEntry" && Array.isArray(data.pages))
          throw new Error(
            "Create journal pages separately after creating the journal.",
          );
        if (
          !validSession(session, socket!) ||
          (authorization === "automatic" && !runtime.autoWrites)
        )
          throw new Error(
            "GM session or write authorization changed before write.",
          );
        const result = await typeClass(type).create(data);
        return { ok: true, data: serialize(result) };
      }
      case "update_document": {
        const doc = await lookup(String(args.uuid));
        const type = doc.documentName;
        if (
          !documentTypes.includes(type) &&
          !embeddedTypes.some((candidate: string) => candidate === type)
        )
          throw new Error("This document type cannot be updated.");
        if (doc.compendium)
          throw new Error("Compendium documents are read-only.");
        const data = sanitizeWrite(args.data as Record<string, unknown>, type);
        if (
          type === "JournalEntryPage" &&
          typeof data["text.content"] === "string"
        )
          data["text.content"] = DOMPurify.sanitize(
            data["text.content"] as string,
          );
        if (
          type === "JournalEntryPage" &&
          typeof data.text === "object" &&
          data.text !== null
        ) {
          const text = data.text as Record<string, unknown>;
          if (typeof text.content === "string")
            text.content = DOMPurify.sanitize(text.content);
        }
        if (
          !validSession(session, socket!) ||
          (authorization === "automatic" && !runtime.autoWrites)
        )
          throw new Error(
            "GM session or write authorization changed before write.",
          );
        const result = await doc.update(data);
        return { ok: true, data: serialize(result) };
      }
      case "create_embedded": {
        const parent = await lookup(String(args.parentUuid));
        if (parent.compendium)
          throw new Error("Compendium documents are read-only.");
        const type = args.documentType as string;
        if (!embeddedTypes.some((candidate: string) => candidate === type))
          throw new Error("Unsupported embedded document type.");
        if (type === "Token" && parent.documentName !== "Scene")
          throw new Error("Tokens can only be created in a Scene.");
        if (
          type === "JournalEntryPage" &&
          parent.documentName !== "JournalEntry"
        )
          throw new Error("Pages can only be created in a JournalEntry.");
        if (type === "Item" && parent.documentName !== "Actor")
          throw new Error("Items can only be created in an Actor.");
        const data = sanitizeWrite(args.data as Record<string, unknown>, type);
        if (
          type === "JournalEntryPage" &&
          typeof data.text === "object" &&
          data.text !== null
        ) {
          const text = data.text as Record<string, unknown>;
          if (typeof text.content === "string")
            text.content = DOMPurify.sanitize(text.content);
        }
        if (
          !validSession(session, socket!) ||
          (authorization === "automatic" && !runtime.autoWrites)
        )
          throw new Error(
            "GM session or write authorization changed before write.",
          );
        const created = await parent.createEmbeddedDocuments(type, [data]);
        return { ok: true, data: created.map(serialize) };
      }
      case "import_compendium": {
        const source = await lookup(String(args.uuid));
        const pack = source.compendium;
        if (!pack) throw new Error("Document is not from a compendium.");
        if (
          !["Actor", "Item", "JournalEntry", "Scene"].includes(
            source.documentName,
          )
        )
          throw new Error("Unsupported compendium document type.");
        const cls = typeClass(source.documentName);
        const data = cls?.fromCompendium?.(source) ?? source.toObject();
        const clean = sanitizeImported(data, source.documentName);
        if (
          !validSession(session, socket!) ||
          (authorization === "automatic" && !runtime.autoWrites)
        )
          throw new Error(
            "GM session or write authorization changed before write.",
          );
        const imported = await cls.create(clean);
        return { ok: true, data: serialize(imported) };
      }
      default:
        return failure("UNKNOWN_TOOL", `Unknown tool: ${tool}`);
    }
  } catch (error: any) {
    const result = failure(
      error?.code ?? "OPERATION_FAILED",
      error?.message ?? String(error),
    );
    if (!result.ok && error?.partial !== undefined)
      result.error.partial = error.partial;
    return result;
  }
}
function recordOutcome(id: string, tool: string, outcome: string) {
  runtime.history.push({ id, tool, outcome, at: new Date().toISOString() });
  if (runtime.history.length > 100)
    runtime.history.splice(0, runtime.history.length - 100);
}
function respond(
  id: string,
  result: ToolResult,
  socket = runtime.socket,
  tool = "unknown",
) {
  respondRaw(id, result, socket);
  recordOutcome(id, tool, result.ok ? "success" : result.error.code);
}
function respondRaw(id: string, result: ToolResult, socket = runtime.socket) {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: "response", id, result }));
}
function validSession(expected: BridgeIdentity, socket: WebSocket): boolean {
  return (
    gm() &&
    runtime.socket === socket &&
    socket.readyState === WebSocket.OPEN &&
    identity().worldId === expected.worldId &&
    identity().userId === expected.userId &&
    runtime.worldId === expected.worldId &&
    runtime.userId === expected.userId
  );
}
async function handleRequest(request: BridgeRequest, socket: WebSocket) {
  if (runtime.seen.has(request.id)) {
    respond(
      request.id,
      failure("DUPLICATE", "This request ID has already been handled."),
      socket,
      request.tool,
    );
    return;
  }
  runtime.seen.add(request.id);
  const before = identity();
  if (!validSession(before, socket)) {
    respond(
      request.id,
      failure("SESSION_CHANGED", "GM or world changed. Reconnect the bridge."),
      socket,
      request.tool,
    );
    return;
  }
  let parsed;
  try {
    parsed = parseTool(request.tool, request.args);
  } catch (e: any) {
    respond(
      request.id,
      failure("INVALID_INPUT", e.message),
      socket,
      request.tool,
    );
    return;
  }
  if (writeTools.has(parsed.tool) && !runtime.autoWrites) {
    const timer = window.setTimeout(() => {
      const pending = runtime.queue.get(request.id);
      if (pending) {
        runtime.queue.delete(request.id);
        respond(
          request.id,
          failure("APPROVAL_EXPIRED", "Approval expired after five minutes."),
          pending.socket,
          request.tool,
        );
        runtime.app?.render(true);
      }
    }, APPROVAL_TIMEOUT_MS);
    runtime.queue.set(request.id, {
      request: { ...request, args: parsed.args },
      timer,
      socket,
      identity: before,
    });
    runtime.app?.render(true);
    return;
  }
  const result = await execute(
    parsed.tool,
    parsed.args,
    before,
    socket,
    "automatic",
  );
  respond(request.id, result, socket, request.tool);
}
function receive(raw: MessageEvent) {
  const socket = raw.currentTarget as WebSocket;
  if (
    typeof raw.data !== "string" ||
    new Blob([raw.data]).size > MAX_MESSAGE_BYTES
  ) {
    runtime.socket?.close(1009, "Message exceeds size limit");
    return;
  }
  let data: any;
  try {
    data = JSON.parse(raw.data);
  } catch {
    return;
  }
  if (data.type === "paired") {
    runtime.sessionId = String(data.sessionId ?? "");
    runtime.worldId = identity().worldId;
    runtime.userId = identity().userId;
    notify(`MCP companion paired with ${gameRef().world.title}.`);
    runtime.app?.render(true);
    return;
  }
  if (data.type === "error") {
    notify(String(data.message ?? "Bridge error"), "error");
    return;
  }
  if (
    data.type === "request" &&
    typeof data.id === "string" &&
    typeof data.tool === "string"
  ) {
    void handleRequest(data as BridgeRequest, socket);
  }
}
function connect() {
  if (!gm()) {
    notify("Only a GM can connect the MCP bridge.", "error");
    return;
  }
  disconnect(false);
  let url: URL;
  try {
    url = safeUrl(runtime.endpoint);
  } catch (e: any) {
    notify(e.message, "error");
    return;
  }
  if (!runtime.token.trim()) {
    notify("Enter the companion pairing token first.", "error");
    return;
  }
  const socket = new WebSocket(url);
  runtime.socket = socket;
  runtime.autoWrites = false;
  runtime.queue.clear();
  runtime.seen.clear();
  runtime.sessionId = undefined;
  runtime.worldId = identity().worldId;
  runtime.userId = identity().userId;
  socket.addEventListener("open", () => {
    if (socket !== runtime.socket || !gm()) return;
    socket.send(
      JSON.stringify({
        type: "hello",
        token: runtime.token,
        identity: identity(),
      }),
    );
    runtime.app?.render(true);
  });
  socket.addEventListener("message", receive);
  socket.addEventListener("close", () => {
    if (socket === runtime.socket) {
      runtime.socket = undefined;
      runtime.autoWrites = false;
      for (const [id, p] of runtime.queue) {
        clearTimeout(p.timer);
        respond(
          id,
          failure(
            "DISCONNECTED",
            "Request cancelled because the bridge disconnected.",
          ),
        );
      }
      runtime.queue.clear();
      runtime.sessionId = undefined;
      runtime.worldId = undefined;
      runtime.userId = undefined;
      runtime.app?.render(true);
    }
  });
  socket.addEventListener("error", () =>
    notify(
      "Could not connect to the MCP companion. Check its URL and trusted certificate.",
      "error",
    ),
  );
}
function disconnect(show = true) {
  if (runtime.socket) {
    const s = runtime.socket;
    runtime.socket = undefined;
    s.close();
  }
  runtime.autoWrites = false;
  runtime.sessionId = undefined;
  runtime.worldId = undefined;
  runtime.userId = undefined;
  for (const [id, p] of runtime.queue) {
    clearTimeout(p.timer);
    if (show)
      respond(
        id,
        failure(
          "DISCONNECTED",
          "Request cancelled because the bridge disconnected.",
        ),
      );
  }
  runtime.queue.clear();
  if (show) runtime.app?.render(true);
}

const ApplicationV2 = g.foundry?.applications?.api?.ApplicationV2;
class BridgeApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-mcp-bridge",
    window: { title: "Foundry MCP Bridge", resizable: true },
    position: { width: 520, height: "auto" },
  };
  constructor(...args: any[]) {
    super(...args);
    runtime.app = this;
  }
  _renderHTML(): HTMLElement {
    const root = document.createElement("section");
    root.className = "fvtt-mcp";
    const status =
      runtime.socket?.readyState === WebSocket.OPEN
        ? "Connected"
        : "Disconnected";
    root.innerHTML = `<p class="status">Status: <strong>${status}</strong>${runtime.sessionId ? " · paired" : ""}</p><label>Companion secure WebSocket URL<input name="endpoint" type="url" value="${escapeHtml(runtime.endpoint)}" placeholder="wss://127.0.0.1:31415/bridge"></label><label>Pairing token<input name="token" type="password" autocomplete="off" value="${escapeHtml(runtime.token)}"></label><div class="actions"><button data-action="connect">Connect</button><button data-action="disconnect">Disconnect</button></div><label class="check"><input type="checkbox" name="auto" ${runtime.autoWrites ? "checked" : ""} ${runtime.socket?.readyState === WebSocket.OPEN ? "" : "disabled"}> Automatically allow writes for this connection</label><p class="hint">GM only. Reads run immediately. Reconnecting always returns to approval mode.</p><h3>Pending write approvals (${runtime.queue.size})</h3><div class="requests"></div><h3>Recent tool outcomes</h3><ol class="history"></ol>`;
    const list = root.querySelector(".requests")!;
    for (const [id, pending] of runtime.queue) {
      const card = document.createElement("article");
      card.className = "request";
      const title = document.createElement("strong");
      title.textContent = pending.request.tool;
      const detail = document.createElement("pre");
      const approvalArgs = { ...pending.request.args };
      if (pending.request.tool === "upload_asset") {
        delete approvalArgs.dataBase64;
        const encoded = String(pending.request.args.dataBase64 ?? "");
        approvalArgs.byteSize = Math.floor((encoded.length * 3) / 4);
      }
      detail.textContent = JSON.stringify(approvalArgs, null, 2);
      const approve = document.createElement("button");
      approve.textContent = "Approve";
      approve.dataset.approve = id;
      const deny = document.createElement("button");
      deny.textContent = "Deny";
      deny.dataset.deny = id;
      card.append(title, detail, approve, deny);
      list.append(card);
    }
    const history = root.querySelector(".history")!;
    for (const item of runtime.history.slice(-20).reverse()) {
      const row = document.createElement("li");
      row.textContent = `${item.at} · ${item.tool} · ${item.outcome}`;
      history.append(row);
    }
    root.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      if (target.name === "endpoint") runtime.endpoint = target.value;
      if (target.name === "token") runtime.token = target.value;
      if (target.name === "auto") {
        runtime.autoWrites = target.checked;
      }
    });
    root.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest(
        "button",
      ) as HTMLButtonElement | null;
      if (!button) return;
      if (button.dataset.action === "connect") {
        runtime.endpoint = (
          root.querySelector('[name="endpoint"]') as HTMLInputElement
        ).value;
        runtime.token = (
          root.querySelector('[name="token"]') as HTMLInputElement
        ).value;
        connect();
      }
      if (button.dataset.action === "disconnect") disconnect();
      if (button.dataset.approve) void this.approve(button.dataset.approve);
      if (button.dataset.deny) this.deny(button.dataset.deny);
    });
    return root;
  }
  _replaceHTML(element: HTMLElement, content: HTMLElement) {
    content.replaceChildren(element);
  }
  async approve(id: string) {
    const pending = runtime.queue.get(id);
    if (!pending) return;
    runtime.queue.delete(id);
    clearTimeout(pending.timer);
    this.render(true);
    const before = pending.identity;
    if (!validSession(before, pending.socket)) {
      respond(
        id,
        failure(
          "SESSION_CHANGED",
          "GM, world or bridge changed before approval.",
        ),
      );
      return;
    }
    const result = await execute(
      pending.request.tool,
      pending.request.args,
      before,
      pending.socket,
      "approved",
    );
    respond(id, result, pending.socket, pending.request.tool);
  }
  deny(id: string) {
    const pending = runtime.queue.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    runtime.queue.delete(id);
    respond(id, failure("DENIED", "GM denied this write."));
    this.render(true);
  }
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
g.Hooks.once("init", () => {
  if (!ApplicationV2) {
    console.error(`${MODULE_ID}: Foundry ApplicationV2 API unavailable.`);
    return;
  }
  runtime.app = new BridgeApp();
});
g.Hooks.once("ready", () => {
  if (!gm()) return;
  gameRef().settings.register(MODULE_ID, "companionUrl", {
    name: "MCP companion URL",
    scope: "client",
    config: true,
    type: String,
    default: "wss://127.0.0.1:31415/bridge",
  });
  gameRef().settings.register(MODULE_ID, "pairingToken", {
    name: "MCP pairing token",
    hint: "Keep this secret. It is stored in your local Foundry client settings.",
    scope: "client",
    config: true,
    type: String,
    default: "",
  });
  runtime.endpoint = gameRef().settings.get(MODULE_ID, "companionUrl");
  runtime.token = gameRef().settings.get(MODULE_ID, "pairingToken");
  gameRef().settings.register(MODULE_ID, "assetRoot", {
    name: "MCP asset upload root",
    hint: "Relative folder under Foundry data for MCP image uploads.",
    scope: "world",
    config: true,
    type: String,
    default: "assets/foundry-mcp",
    restricted: true,
  });
  gameRef().settings.register(MODULE_ID, "pf2eEnabled", {
    name: "Enable PF2e integrations",
    hint: "Allow PF2e-specific MCP tools in PF2e worlds.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true,
  });
  gameRef().settings.register(MODULE_ID, "damageApplications", {
    name: "Damage application records",
    scope: "world",
    config: false,
    type: Object,
    default: { version: 1, entries: {} },
    restricted: true,
  });
  gameRef().settings.registerMenu(MODULE_ID, "openBridge", {
    name: "Open MCP Bridge",
    label: "Open Bridge",
    hint: "Connect a local MCP companion to this world.",
    icon: "fas fa-plug",
    type: BridgeApp,
    restricted: true,
  });
});
void toolNames;

export const __test = {
  execute,
  runtime,
  identity,
  safeUrl,
  sanitizeWrite,
  sanitizeImported,
  canonicalRelativePath,
  decodeImageBase64,
  validateImageFilename,
  searchableText,
  handleRequest,
  disconnect,
  BridgeApp,
};
