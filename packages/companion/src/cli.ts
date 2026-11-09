import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { CompanionDaemon, type CompanionConfig } from "./daemon.js";
import { validateTlsFiles } from "./config.js";
const configDir = () =>
  process.env.FOUNDRY_MCP_CONFIG_DIR ||
  path.join(
    process.env.APPDATA ||
      process.env.XDG_CONFIG_HOME ||
      path.join(os.homedir(), ".config"),
    "foundry-mcp",
  );
const configPath = () => path.join(configDir(), "config.json");
function readConfig(): CompanionConfig {
  return JSON.parse(fs.readFileSync(configPath(), "utf8"));
}
function call(config: CompanionConfig, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: config.port ?? 31415,
        path: "/rpc",
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
        },
        ca: fs.readFileSync(config.caPath ?? config.certPath),
        timeout: 320000,
        servername: "localhost",
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let parsed: any;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            return reject(new Error(`Daemon returned HTTP ${res.statusCode}`));
          }
          if (res.statusCode && res.statusCode >= 400)
            return reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          resolve(parsed);
        });
      },
    );
    req.setTimeout(320000, () =>
      req.destroy(
        new Error(
          "Companion request timed out; check Foundry before retrying writes.",
        ),
      ),
    );
    req.on("error", reject);
    req.end(data);
  });
}
function toolDescription(name: string): string {
  const descriptions: Record<string, string> = {
    pf2e_combat_context:
      "Inspect the active PF2e encounter, current combatant, explicit scene targets, conditions, and prepared strike selectors. Read-only; supply the returned expected round, turn, and combatant to a subsequent strike or damage roll.",
    pf2e_roll_strike:
      "Roll a selected primary PF2e strike against an explicit target using the native strike variant and MAP. Requires the current combatant and fresh expected tracker state. Native PF2e chat is GM-only; consumable weapons are not supported for strike rolls. Native rule hooks may still run; inspect Foundry before retrying any uncertain result.",
    pf2e_roll_damage:
      "Roll normal or critical damage for a selected primary PF2e strike against an explicit target. Requires the current combatant and fresh expected tracker state. Native PF2e damage chat is GM-only. This posts damage for manual review and does not apply it to HP; inspect Foundry before retrying any uncertain result.",
    pf2e_inspect_damage_application:
      "Inspect a selected native PF2e damage roll from a chat message against an explicit scene token. Returns review facts and a one-use reviewToken for the same message, roll, target and options. It does not apply damage or guarantee final HP/IWR results. Requires PF2e.",
    pf2e_apply_damage:
      "Apply a previously inspected native PF2e damage roll to the same explicit target with identical operation, multiplier and Shield Block options, using its reviewToken. Requires GM approval. Native PF2e application may run persistent-damage, defeated and other hooks. A durable reservation prevents duplicate module-mediated application; uncertain results require manual reconciliation and must not be retried blindly. No automatic persistent-damage ticks, spell shields, rollback or undo are provided.",
    pf2e_roll_check:
      "Roll a PF2e Perception, skill or saving throw using the actor's prepared statistic and native PF2e modifiers. Posts a Foundry chat roll; messageMode defaults to GM-only. Requires GM approval. Does not roll attacks, damage or spend resources; failed or interrupted outcomes may be uncertain, so inspect chat before retrying.",
    pf2e_inspect_actions:
      "Inspect bounded PF2e action, strike and check information for an actor. This reports available data and does not execute an action, attack or damage roll.",
    pf2e_roll_initiative:
      "Roll PF2e initiative for selected encounter combatants using each actor's configured initiative statistic (including Stealth if configured). Skips combatants with existing initiative unless reroll is true. Uses native PF2e rolls and tracker updates; messageMode defaults to GM-only. Requires GM approval and must not be automatically retried.",
    start_encounter:
      "Activate and start an encounter with Foundry's native combat APIs. Every combatant must already have initiative. This advances the world into live combat; requires GM approval.",
    next_turn:
      "Advance a started encounter by one turn using Foundry's native nextTurn API. Supply expectedRound, expectedTurn and expectedCombatantUuid from the latest inspect_encounter result; stale state is rejected. Requires GM approval and must not be automatically retried.",
    pf2e_status:
      "Report whether the active world is PF2e and which optional PF2e features are available. PF2e tools are listed in every world but return a clear unavailable result on other systems.",
    pf2e_search_compendium:
      "Search PF2e creature, hazard, or equipment compendiums by level, traits, rarity, size, type, price, and text. Read-only; requires PF2e.",
    pf2e_party_summary:
      "Summarize a PF2e party's member levels and encounter-planning context. Read-only; requires PF2e.",
    pf2e_import_document:
      "Import one native PF2e compendium document while preserving supported source data; optional elite or weak adjustment uses PF2e's own APIs. Requires GM approval unless session auto-write is enabled.",
    pf2e_analyze_encounter:
      "Analyze PF2e encounter difficulty using native encounter XP calculations. This does not award XP or create an encounter. Read-only; requires PF2e.",
    pf2e_stage_encounter:
      "Create encounter participants as hidden scene tokens with optional elite or weak adjustment. This does not create or start combat. Requires GM approval unless session auto-write is enabled; partial results identify created UUIDs and the failed placement.",
    pf2e_inspect_conditions:
      "Inspect native PF2e conditions and values on an Actor or supported token Actor. Read-only; persistent-damage rolls and damage application are not automated.",
    pf2e_set_condition:
      "Set a PF2e condition to the exact requested value (not an increment); omit value for an unvalued condition. PF2e grant and lock rules remain in effect. Requires GM approval unless session auto-write is enabled.",
    pf2e_adjust_condition:
      "Increase, decrease, or remove a specific PF2e condition by UUID using native system APIs while respecting PF2e grant and lock rules. Requires GM approval; this changes the condition state.",
    pf2e_apply_effect:
      "Apply a PF2e compendium effect to a target using native duration and grant behavior. Requires GM approval unless session auto-write is enabled.",
    pf2e_remove_effect:
      "Remove a specific PF2e effect by UUID. Requires GM approval; this removes existing document state.",
    pf2e_inventory:
      "Inspect PF2e inventory items and coin denominations on an Actor. Read-only; no XP is awarded.",
    pf2e_add_inventory_item:
      "Add a PF2e compendium item to inventory with a bounded quantity, using native stacking unless a new stack is requested. Requires GM approval.",
    pf2e_set_item_quantity:
      "Set an existing PF2e inventory item's quantity to an exact positive value (1–9999), increasing or decreasing it. Zero is rejected; use transfer or a system-specific workflow to remove an item. Requires GM approval.",
    pf2e_transfer_item:
      "Physically transfer a PF2e inventory item and quantity between actors, preserving supported source data. Requires GM approval; partial results may require reconciliation.",
    pf2e_add_coins:
      "Add positive PF2e coin amounts by denomination to an Actor; it does not deduct coins. Requires GM approval.",
    pf2e_create_loot:
      "Create a PF2e loot Actor with requested compendium items and optional coins. Default ownership remains Foundry's world behavior. Requires GM approval; partial results identify created UUIDs.",
    upload_asset:
      "Upload a PNG, JPEG, WebP, GIF, or AVIF image (up to 8 MiB) to the configured Foundry asset directory. Provide exactly one source: dataBase64, or localPath on the companion computer. SVG is not supported.",
    browse_assets:
      "Browse image assets already available under the configured Foundry asset root.",
    search_content:
      "Search world documents, including journals, actors, items, scenes, folders, and pages where supported.",
    create_folder:
      "Create a Foundry folder for a supported document type. Requires GM approval unless session auto-write is enabled.",
    move_document:
      "Move a world document into a folder or to the root. Requires GM approval unless session auto-write is enabled.",
    inspect_scene:
      "Inspect scene dimensions, grid, background image, and existing token placement before preparing map content.",
    add_map_note:
      "Add a journal-linked note to a scene. Requires GM approval unless session auto-write is enabled.",
    import_compendium:
      "Import a system-neutral supported Foundry document from a compendium. In PF2e worlds, use pf2e_import_document instead to preserve PF2e embedded mechanics and apply native elite or weak adjustments.",
    create_embedded:
      "Create a supported embedded JournalEntryPage, Actor Item, or Scene Token. Requires GM approval unless session auto-write is enabled.",
    update_document:
      "Update a supported world document using Foundry document fields. Requires GM approval unless session auto-write is enabled.",
    list_encounters:
      "List bounded combat preparation records, optionally filtered to a scene. Read-only; started combat is not modified.",
    inspect_encounter:
      "Inspect one bounded combat preparation record and its participants. Read-only; no live turn state is changed.",
    create_encounter:
      "Create an inactive, unstarted combat preparation record for the selected scene. Does not activate the scene, roll initiative, or start combat. Requires GM approval.",
    add_combatants:
      "Add selected scene token UUIDs to an unstarted preparation record; duplicates are skipped. Does not create or move tokens or modify started combat. Requires GM approval.",
    remove_combatants:
      "Remove explicitly selected combatant UUIDs from an unstarted preparation record. Requires GM approval; this is a scoped destructive operation.",
    session_snapshot:
      "Return a bounded factual snapshot of selected party, scene, encounter, and journal data for an agent to summarize. Read-only; the server does not generate a briefing.",
  };
  const detail =
    descriptions[name] ?? `Foundry VTT ${name.replaceAll("_", " ")}.`;
  return `${detail} Read tools work without approval; write tools require GM approval or session auto-write. Writes are never automatically retried.`;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "init") {
    const force = args.includes("--force");
    const values = args.filter((x) => x !== "--force");
    const [origin, certPath, keyPath, caPath] = values;
    if (!origin || !certPath || !keyPath || !caPath)
      throw Error(
        "Usage: foundry-mcp init <https-foundry-origin> <cert.pem> <key.pem> <mkcert-root-ca.pem>",
      );
    const url = new URL(origin);
    if (url.protocol !== "https:")
      throw Error("Foundry origin must use HTTPS for the browser bridge.");
    const dir = configDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(configPath()) && !force)
      throw Error(
        `Configuration already exists at ${configPath()}; pass --force to replace it and rotate the pairing token.`,
      );
    const port = Number(process.env.FOUNDRY_MCP_PORT) || 31415;
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw Error("FOUNDRY_MCP_PORT must be an integer from 1 to 65535.");
    const resolvedCertPath = path.resolve(certPath);
    const resolvedKeyPath = path.resolve(keyPath);
    const resolvedCaPath = path.resolve(caPath);
    validateTlsFiles(resolvedCertPath, resolvedKeyPath, resolvedCaPath);
    const cfg: CompanionConfig = {
      origin: url.origin,
      certPath: resolvedCertPath,
      keyPath: resolvedKeyPath,
      caPath: resolvedCaPath,
      token: crypto.randomBytes(32).toString("hex"),
      port,
    };
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), {
      mode: 0o600,
    });
    console.error(
      `Initialized ${configPath()}. Enter this pairing token in the Foundry module: ${cfg.token}`,
    );
    return;
  }
  if (command === "start") {
    const d = new CompanionDaemon(readConfig());
    await d.start();
    console.error(
      `Foundry MCP companion listening at https://127.0.0.1:${process.env.FOUNDRY_MCP_PORT || 31415}`,
    );
    process.on("SIGINT", () => void d.stop().finally(() => process.exit(0)));
    process.on("SIGTERM", () => void d.stop().finally(() => process.exit(0)));
    return;
  }
  if (command === "mcp") {
    if (
      Number(process.versions.node.split(".")[0]) < 22 ||
      (Number(process.versions.node.split(".")[0]) === 22 &&
        Number(process.versions.node.split(".")[1]) < 12)
    )
      throw Error("The MCP client requires Node.js 22.12 or newer.");
    const config = readConfig();
    const { McpServer } =
      await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { StdioServerTransport } =
      await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { toolNames, toolSchemas, writeTools, destructiveTools } =
      await import("@foundry-mcp/shared");
    const server = new McpServer({ name: "foundry-vtt", version: "0.8.1" });
    for (const name of toolNames) {
      const schema = toolSchemas[name];
      const shape = Object.fromEntries(
        Object.entries(schema.shape).map(([k, v]) => [k, v as any]),
      );
      server.registerTool(
        name,
        {
          description: toolDescription(name),
          annotations: {
            readOnlyHint: !writeTools.has(name),
            destructiveHint: destructiveTools.has(name),
            idempotentHint: false,
            openWorldHint: false,
          },
          inputSchema: shape,
        },
        async (args: any) => {
          try {
            const result = await call(config, {
              id: crypto.randomUUID(),
              tool: name,
              args,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              isError: result?.ok === false,
            };
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    error: {
                      code: writeTools.has(name)
                        ? "OUTCOME_UNKNOWN"
                        : "COMPANION_UNAVAILABLE",
                      message: writeTools.has(name)
                        ? `The connection ended before the write result was confirmed. Check Foundry before retrying. ${e instanceof Error ? e.message : ""}`
                        : e instanceof Error
                          ? e.message
                          : "Local companion is unavailable",
                    },
                  }),
                },
              ],
              isError: true,
            };
          }
        },
      );
    }
    await server.connect(new StdioServerTransport());
    return;
  }
  if (command === "status") {
    try {
      console.log(
        JSON.stringify(
          await call(readConfig(), {
            id: crypto.randomUUID(),
            tool: "get_status",
            args: {},
          }),
          null,
          2,
        ),
      );
    } catch (e) {
      console.log(
        JSON.stringify(
          {
            connected: false,
            error: e instanceof Error ? e.message : "Companion unavailable",
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    }
    return;
  }
  console.error("Usage: foundry-mcp <init|start|mcp|status>");
  process.exitCode = 2;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
