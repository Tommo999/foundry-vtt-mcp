import DOMPurify from "dompurify";
import { documentTypes, embeddedTypes, MAX_ASSET_BYTES, type ToolName, type ToolResult } from "@foundry-mcp/shared";
import { sanitizeData, validateObject } from "./security";
import { canonicalRelativePath, decodeImageBase64, validateImageFilename } from "./assets";
import type { BridgeContext } from "./bridge-context";

const MODULE_ID = "foundry-vtt-mcp";
const g = globalThis as any;
const gameRef = () => g.game;

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

const GENERAL_TOOLS = new Set<ToolName>(["discover_types", "search_content", "list_folders", "browse_assets", "inspect_scene", "search_world", "list_compendiums", "search_compendium", "get_document", "create_folder", "move_document", "upload_asset", "add_map_note", "create_document", "update_document", "create_embedded", "import_compendium"]);
export function isGeneralDocumentTool(tool: ToolName): boolean { return GENERAL_TOOLS.has(tool); }

export async function handleGeneralDocumentTool(tool: ToolName, args: Record<string, unknown>, ctx: BridgeContext): Promise<ToolResult | undefined> {
  if (!GENERAL_TOOLS.has(tool)) return undefined;
  const game = ctx.game;
  const g = globalThis as any;
  const lookup = ctx.resolve.bind(ctx);
  const serialize = ctx.serialize.bind(ctx);
  switch (tool) {

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
        ctx.assertWrite();
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
        ctx.assertWrite();
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
            ctx.assertWrite();
            await FilePicker.createDirectory("data", cursor);
          }
        }
        ctx.assertWrite();
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
        ctx.assertWrite();
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
        ctx.assertWrite();
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
        ctx.assertWrite();
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
        ctx.assertWrite();
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
        ctx.assertWrite();
        const imported = await cls.create(clean);
        return { ok: true, data: serialize(imported) };
      }
      default: return undefined;
  }
}

export { sanitizeWrite, sanitizeImported, typeSchema, searchableText };
