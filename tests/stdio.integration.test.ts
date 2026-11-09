import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CompanionDaemon } from "../packages/companion/src/daemon.js";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import { readFile } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "packages/companion/dist/cli.js");
let tempDir = "";
let daemon: CompanionDaemon;
let port = 0;
let client: Client;
let transport: StdioClientTransport;
let browserSocket: WebSocket | undefined;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate test port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

describe("companion MCP stdio integration", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "foundry-mcp-integration-"));
    const cert = join(tempDir, "localhost.pem");
    const key = join(tempDir, "localhost-key.pem");
    // These self-signed credentials are test-only fixtures and must never be reused for deployment.
    await copyFile(join(root, "tests/fixtures/localhost.pem"), cert);
    await copyFile(join(root, "tests/fixtures/localhost-key.pem"), key);
    port = await freePort();
    const token = randomBytes(32).toString("hex");
    daemon = new CompanionDaemon({
      origin: "https://foundry.test",
      token,
      certPath: cert,
      keyPath: key,
      caPath: cert,
      port,
    });
    await daemon.start();
    const configDir = join(tempDir, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({
        origin: "https://foundry.test",
        token,
        certPath: cert,
        keyPath: key,
        caPath: cert,
        port,
      }),
      { mode: 0o600 },
    );
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp"],
      env: { ...process.env, FOUNDRY_MCP_CONFIG_DIR: configDir },
    });
    client = new Client({
      name: "foundry-mcp-integration-test",
      version: "0.1.0",
    });
    await client.connect(transport);
  }, 20_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    browserSocket?.close();
    await daemon?.stop();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }, 10_000);

  it("lists registered tools over MCP stdio", async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toContain("get_status");
    expect(result.tools.map((tool) => tool.name)).toContain("create_document");
    expect(result.tools.map((tool) => tool.name)).toContain("search_content");
    expect(result.tools.map((tool) => tool.name)).toContain("upload_asset");
    expect(result.tools.map((tool) => tool.name)).toContain(
      "pf2e_search_compendium",
    );
    expect(result.tools.map((tool) => tool.name)).toContain(
      "pf2e_stage_encounter",
    );
    expect(result.tools.map((tool) => tool.name)).toContain(
      "pf2e_inspect_conditions",
    );
    expect(result.tools.map((tool) => tool.name)).toContain("pf2e_create_loot");
    expect(result.tools.map((tool) => tool.name)).toContain("pf2e_roll_check");
    expect(result.tools.map((tool) => tool.name)).toContain(
      "pf2e_inspect_actions",
    );
    expect(result.tools.map((tool) => tool.name)).toContain(
      "pf2e_roll_initiative",
    );
    expect(result.tools.map((tool) => tool.name)).toContain("start_encounter");
    expect(result.tools.map((tool) => tool.name)).toContain("next_turn");
    expect(result.tools.map((tool) => tool.name)).toContain(
      "pf2e_combat_context",
    );
    expect(result.tools.map((tool) => tool.name)).toContain("pf2e_roll_strike");
    expect(result.tools.map((tool) => tool.name)).toContain("pf2e_roll_damage");
    expect(result.tools.map((tool) => tool.name)).toContain(
      "pf2e_inspect_damage_application",
    );
    expect(result.tools.map((tool) => tool.name)).toContain(
      "pf2e_apply_damage",
    );
    expect(result.tools).toHaveLength(51);
    expect(
      result.tools.find(
        (tool) => tool.name === "pf2e_inspect_damage_application",
      )?.annotations,
    ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(
      result.tools.find((tool) => tool.name === "pf2e_apply_damage")
        ?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(
      result.tools.find((tool) => tool.name === "search_content")?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "create_folder")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_analyze_encounter")
        ?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_import_document")
        ?.annotations?.readOnlyHint,
    ).toBe(false);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_set_condition")
        ?.annotations?.destructiveHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_inspect_conditions")
        ?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_transfer_item")
        ?.annotations?.destructiveHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "session_snapshot")?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "remove_combatants")
        ?.annotations?.destructiveHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_inspect_actions")
        ?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_roll_check")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    expect(
      result.tools.find((tool) => tool.name === "next_turn")?.annotations
        ?.destructiveHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_combat_context")
        ?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_roll_strike")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    expect(
      result.tools.find((tool) => tool.name === "pf2e_roll_damage")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
  }, 10_000);

  it("routes get_status through HTTPS and returns an offline status without replay", async () => {
    const result = await client.callTool({ name: "get_status", arguments: {} });
    expect(result.isError).not.toBe(true);
    const content = (
      result as unknown as { content: Array<{ type: string; text?: string }> }
    ).content;
    const body = JSON.parse(
      content[0].type === "text" ? (content[0].text ?? "{}") : "{}",
    );
    expect(body.ok).toBe(true);
    expect(body.data.connected).toBe(false);
  }, 10_000);

  it("routes the added discovery and write tools to the paired GM bridge", async () => {
    const cert = await readFile(join(tempDir, "localhost.pem"));
    browserSocket = new WebSocket(`wss://127.0.0.1:${port}/bridge`, {
      origin: "https://foundry.test",
      ca: cert,
    });
    await new Promise<void>((resolve, reject) => {
      browserSocket!.once("open", resolve);
      browserSocket!.once("error", reject);
    });
    const hello = new Promise<void>((resolve, reject) => {
      browserSocket!.once("message", (raw) => {
        const reply = JSON.parse(raw.toString());
        if (reply.type === "paired") resolve();
        else reject(new Error("Expected paired response"));
      });
    });
    const config = JSON.parse(
      await readFile(join(tempDir, "config", "config.json"), "utf8"),
    );
    browserSocket.send(
      JSON.stringify({
        type: "hello",
        token: config.token,
        identity: {
          worldId: "test-world",
          userId: "test-gm",
          foundryVersion: "14.0.0",
          systemId: "test-system",
          systemVersion: "1.0.0",
        },
      }),
    );
    await hello;

    const routedCall = async (name: string, args: Record<string, unknown>) => {
      const incoming = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`No bridge request for ${name}`)),
          5000,
        );
        browserSocket!.once("message", (raw) => {
          clearTimeout(timeout);
          resolve(JSON.parse(raw.toString()));
        });
      });
      const call = client.callTool({ name, arguments: args });
      const request = await incoming;
      expect(request.tool).toBe(name);
      expect(request.args).toMatchObject(args);
      browserSocket!.send(
        JSON.stringify({
          type: "response",
          id: request.id,
          result: { ok: true, data: { accepted: name } },
        }),
      );
      const result = await call;
      const body = JSON.parse(
        (
          result as unknown as {
            content: Array<{ type: string; text?: string }>;
          }
        ).content[0].text ?? "{}",
      );
      expect(body.data.accepted).toBe(name);
    };
    await routedCall("search_content", {
      query: "storm",
      offset: 0,
      limit: 25,
    });
    await routedCall("create_folder", {
      name: "Places",
      documentType: "JournalEntry",
    });
    await routedCall("pf2e_inspect_conditions", { targetUuid: "Actor.test" });
    await routedCall("pf2e_transfer_item", {
      sourceActorUuid: "Actor.source",
      targetActorUuid: "Actor.target",
      itemUuid: "Actor.source.Item.rope",
      quantity: 1,
    });
    await routedCall("list_encounters", { offset: 0, limit: 25 });
    await routedCall("pf2e_combat_context", {
      encounterUuid: "Combat.test",
      offset: 0,
      limit: 25,
    });
    const rollArgs = {
      encounterUuid: "Combat.test",
      attackerTokenUuid: "Scene.test.Token.attacker",
      targetTokenUuid: "Scene.test.Token.target",
      strikeIndex: 0,
      strikeSlug: "longsword",
      strikeItemUuid: "Actor.attacker.Item.longsword",
      expectedRound: 1,
      expectedTurn: 0,
      expectedCombatantUuid: "Combat.test.Combatant.attacker",
      attackNumber: 1,
    };
    await routedCall("pf2e_roll_strike", rollArgs);
    await routedCall("pf2e_roll_damage", { ...rollArgs, critical: false });
    const damageArgs = {
      messageUuid: "ChatMessage.damage",
      targetTokenUuid: "Scene.test.Token.target",
      rollIndex: 0,
      operation: "damage",
      multiplier: 1,
      shieldBlock: false,
    };
    await routedCall("pf2e_inspect_damage_application", damageArgs);
    await routedCall("pf2e_apply_damage", {
      ...damageArgs,
      reviewToken: "a".repeat(64),
    });
    await routedCall("session_snapshot", {
      encounterUuids: [],
      journalUuids: [],
    });
    await routedCall("create_encounter", { sceneUuid: "Scene.test" });

    const partialReply = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("No PF2e staging request reached the bridge")),
        5000,
      );
      browserSocket!.once("message", (raw) => {
        clearTimeout(timeout);
        resolve(JSON.parse(raw.toString()));
      });
    });
    const partialCall = client.callTool({
      name: "pf2e_stage_encounter",
      arguments: {
        sceneUuid: "Scene.test",
        placements: [{ uuid: "Actor.source", x: 10, y: 20 }],
      },
    });
    const stagingRequest = await partialReply;
    expect(stagingRequest.tool).toBe("pf2e_stage_encounter");
    browserSocket!.send(
      JSON.stringify({
        type: "response",
        id: stagingRequest.id,
        result: {
          ok: false,
          error: {
            code: "PF2E_PARTIAL_FAILURE",
            message:
              "Placement 2 failed; inspect created UUIDs before retrying.",
            partial: {
              createdActors: ["Actor.created"],
              createdItems: [],
              createdTokens: ["Scene.test.Token.created"],
              failedPlacementIndex: 1,
            },
          },
        },
      }),
    );
    const partialResult = await partialCall;
    expect(partialResult.isError).toBe(true);
    const partialBody = JSON.parse(
      (partialResult as unknown as { content: Array<{ text?: string }> })
        .content[0].text ?? "{}",
    );
    expect(partialBody.error).toMatchObject({
      code: "PF2E_PARTIAL_FAILURE",
      partial: { createdActors: ["Actor.created"], failedPlacementIndex: 1 },
    });

    const combatPartial = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("No combat removal request reached the bridge")),
        5000,
      );
      browserSocket!.once("message", (raw) => {
        clearTimeout(timeout);
        resolve(JSON.parse(raw.toString()));
      });
    });
    const removeCall = client.callTool({
      name: "remove_combatants",
      arguments: {
        encounterUuid: "Combat.test",
        combatantUuids: ["Combatant.test"],
      },
    });
    const removeRequest = await combatPartial;
    expect(removeRequest.tool).toBe("remove_combatants");
    browserSocket!.send(
      JSON.stringify({
        type: "response",
        id: removeRequest.id,
        result: {
          ok: false,
          error: {
            code: "PARTIAL_FAILURE",
            message: "Removal outcome unknown; inspect combat.",
            partial: { removedUuids: ["Combatant.test"], outcomeUnknown: true },
          },
        },
      }),
    );
    const removeResult = await removeCall;
    expect(removeResult.isError).toBe(true);
    const removeBody = JSON.parse(
      (removeResult as unknown as { content: Array<{ text?: string }> })
        .content[0].text ?? "{}",
    );
    expect(removeBody.error.partial).toMatchObject({
      removedUuids: ["Combatant.test"],
      outcomeUnknown: true,
    });
  }, 15_000);
});
