import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const statePath =
  process.env.FOUNDRY_MCP_LIVE_ACCEPTANCE_STATE ??
  join(tmpdir(), "foundry-mcp-live-v091-progress.json");
const fixturePrefix = "[MCP v0.9.1 ACCEPTANCE]";
const packageVersion = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;
const expectedVersion =
  process.env.FOUNDRY_MCP_EXPECTED_VERSION ?? packageVersion;
const mutationTools = new Set([
  "create_document",
  "create_embedded",
  "update_document",
]);
const fixtures = [
  {
    slug: "prepared",
    category: "prepared",
    rank: 1,
    spell: "healing",
    pool: false,
  },
  {
    slug: "flexible",
    category: "prepared",
    flexible: true,
    signature: true,
    rank: 1,
    spell: "healing",
    pool: true,
  },
  {
    slug: "spontaneous",
    category: "spontaneous",
    rank: 1,
    spell: "healing",
    pool: true,
    signature: true,
  },
  { slug: "focus", category: "focus", rank: 1, spell: "focus", pool: false },
  {
    slug: "cantrip",
    category: "spontaneous",
    rank: 0,
    spell: "cantrip",
    pool: true,
  },
  {
    slug: "innate",
    category: "innate",
    rank: 1,
    spell: "healing",
    pool: false,
  },
];

function parseText(result) {
  const item = result?.content?.find((part) => part.type === "text");
  if (!item) throw new Error("MCP tool returned no text content.");
  return JSON.parse(item.text);
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      /^(secret|password|authorization|pairingToken|privateKey|certPath|caPath)$/i.test(
        key,
      )
    )
      continue;
    output[key] = sanitize(item);
  }
  return output;
}
async function save(state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(sanitize(state), null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(statePath, 0o600);
}
async function load() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      return {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        stages: {},
      };
    throw error;
  }
}
function slotGroups() {
  return Object.fromEntries(
    Array.from({ length: 11 }, (_, rank) => [
      `slot${rank}`,
      {
        prepared: [],
        value: 0,
        max: 0,
      },
    ]),
  );
}
function spellSource(fixture, entryId) {
  const cantrip = fixture.spell === "cantrip";
  const focus = fixture.spell === "focus";
  return {
    name: cantrip
      ? "Acceptance Guidance"
      : focus
        ? "Acceptance Focus"
        : "Acceptance Heal",
    type: "spell",
    system: {
      level: { value: cantrip ? 1 : 1 },
      traits: {
        rarity: "common",
        traditions: ["arcane", "divine", "occult", "primal"],
        value: cantrip
          ? ["cantrip", "concentrate"]
          : focus
            ? ["focus", "concentrate"]
            : ["healing", "manipulate"],
      },
      time: { value: "1" },
      range: { value: "touch" },
      target: { value: "1 creature" },
      area: null,
      cost: { value: "" },
      duration: { value: "", sustained: false },
      requirements: "",
      counteraction: false,
      damage: {},
      defense: null,
      rules: [],
      cast: { focusPoints: focus ? 1 : 0 },
      location: {
        value: entryId,
        heightenedLevel: null,
        uses: fixture.category === "innate" ? { value: 2, max: 2 } : null,
        signature: fixture.signature === true,
      },
    },
  };
}
function entrySource(fixture, spellId = null) {
  const slots = slotGroups();
  if (fixture.rank === 0)
    slots.slot0 = {
      prepared: spellId ? [{ id: spellId, expended: false }] : [],
      value: 0,
      max: spellId ? 1 : 0,
    };
  else if (fixture.rank > 0)
    slots[`slot${fixture.rank}`] = {
      prepared: fixture.pool
        ? []
        : spellId
          ? [{ id: spellId, expended: false }]
          : [],
      value: fixture.pool ? (fixture.category === "prepared" ? 2 : 2) : 0,
      max: fixture.pool ? 2 : spellId ? 1 : 0,
    };
  return {
    name: `${fixturePrefix} ${fixture.slug} Entry`,
    type: "spellcastingEntry",
    system: {
      ability: { value: "int" },
      tradition: { value: "arcane" },
      prepared: {
        value: fixture.category,
        flexible: fixture.flexible === true,
        validItems: "",
      },
      showSlotlessLevels: { value: false },
      proficiency: { slug: "trained", value: 1 },
      spelldc: { value: 17, dc: 17 },
      autoHeightenLevel: { value: null },
      traits: { value: [] },
      slots,
    },
  };
}
function resultDocument(response) {
  const data = response?.data;
  const doc = Array.isArray(data) ? data[0] : data;
  const id = doc?.id ?? doc?._id;
  if (!doc || typeof doc.uuid !== "string" || typeof id !== "string")
    throw new Error(
      "Created document did not return an ID and UUID; stage outcome requires manual reconciliation.",
    );
  return {
    id,
    uuid: doc.uuid,
    name: doc.name,
    type: doc.type,
    documentName: doc.documentName,
  };
}
function validateWriteResult(tool, args, doc) {
  const expectedName = args.data?.name;
  if (typeof expectedName === "string" && doc.name !== expectedName)
    return "returned document name does not match the requested fixture";
  if (tool === "create_document" && doc.documentName !== args.documentType)
    return "returned document type does not match the requested fixture";
  if (tool === "create_embedded") {
    if (doc.documentName !== args.documentType)
      return "returned embedded document type does not match the requested fixture";
    if (!doc.uuid.startsWith(`${args.parentUuid}.`))
      return "returned embedded document is not under the fixture parent";
  }
  if (tool === "update_document" && doc.uuid !== args.uuid)
    return "updated document UUID does not match the requested fixture";
  return null;
}
function validateProgressBinding(saved, currentWorldId, currentVersion) {
  if (!saved?.environment) return;
  if (
    saved.environment.worldId !== currentWorldId ||
    (saved.environment.expectedVersion &&
      saved.environment.expectedVersion !== currentVersion)
  )
    throw new Error(
      "Fixture progress is bound to a different world or version.",
    );
}
function assertNoPendingWork(state) {
  const pendingStage = Object.entries(state.stages ?? {}).find(
    ([, row]) => row.status === "in_flight" || row.status === "uncertain",
  );
  if (pendingStage)
    throw new Error(
      `Stage ${pendingStage[0]} is ${pendingStage[1].status}; refusing replay.`,
    );
  const pendingCheck = Object.entries(state.checks ?? {}).find(
    ([, row]) => row.status === "in_flight" || row.status === "uncertain",
  );
  if (pendingCheck)
    throw new Error(
      `Check ${pendingCheck[0]} is ${pendingCheck[1].status}; refusing replay.`,
    );
}
async function mutate(client, state, stage, tool, args) {
  if (!mutationTools.has(tool))
    throw new Error("Harness mutation allowlist rejected tool.");
  const existing = state.stages[stage];
  if (existing?.status === "complete") return existing.result;
  if (existing)
    throw new Error(
      `Stage ${stage} has prior status ${existing.status}; refusing replay.`,
    );
  state.stages[stage] = {
    status: "in_flight",
    tool,
    startedAt: new Date().toISOString(),
  };
  await save(state);
  let response;
  try {
    response = parseText(
      await client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: 60_000,
      }),
    );
  } catch (error) {
    state.stages[stage].status = "uncertain";
    state.stages[stage].error = String(error).slice(0, 300);
    await save(state);
    throw new Error(
      `Stage ${stage} outcome uncertain; inspect progress and Foundry before continuing.`,
    );
  }
  if (!response.ok) {
    state.stages[stage].status = "uncertain";
    state.stages[stage].error = {
      code: response.error?.code ?? null,
      message: String(response.error?.message ?? "write failed").slice(0, 300),
    };
    await save(state);
    throw new Error(
      `Stage ${stage} did not confirm; treating outcome as uncertain and refusing replay.`,
    );
  }
  const result = resultDocument(response);
  const mismatch = validateWriteResult(tool, args, result);
  if (mismatch) {
    state.stages[stage] = {
      status: "uncertain",
      tool,
      result,
      error: mismatch,
    };
    await save(state);
    throw new Error(
      `Stage ${stage} returned an unexpected document after a confirmed write; no replay. ${mismatch}`,
    );
  }
  state.stages[stage] = {
    status: "complete",
    tool,
    completedAt: new Date().toISOString(),
    result,
  };
  await save(state);
  console.log(JSON.stringify({ stage, status: "complete", result }));
  return result;
}
async function createFixtures(client, state) {
  let scene = state.stages.scene?.result;
  if (!scene)
    scene = await mutate(client, state, "scene", "create_document", {
      documentType: "Scene",
      data: {
        name: `${fixturePrefix} Scene`,
        width: 1400,
        height: 1000,
        padding: 0,
        grid: { type: 1, size: 100, distance: 5, units: "ft" },
      },
    });
  for (const fixture of fixtures) {
    const prefix = fixture.slug;
    let actor = state.stages[`${prefix}.actor`]?.result;
    if (!actor)
      actor = await mutate(
        client,
        state,
        `${prefix}.actor`,
        "create_document",
        {
          documentType: "Actor",
          data: {
            name: `${fixturePrefix} ${prefix}`,
            type: "npc",
            system: {
              details: { level: { value: 5 } },
              resources: {
                focus: {
                  value: fixture.category === "focus" ? 1 : 0,
                  max: fixture.category === "focus" ? 1 : 0,
                },
              },
            },
          },
        },
      );
    let entry = state.stages[`${prefix}.entry`]?.result;
    if (!entry)
      entry = await mutate(
        client,
        state,
        `${prefix}.entry`,
        "create_embedded",
        {
          parentUuid: actor.uuid,
          documentType: "Item",
          data: entrySource(fixture),
        },
      );
    let spell = state.stages[`${prefix}.spell`]?.result;
    if (!spell)
      spell = await mutate(
        client,
        state,
        `${prefix}.spell`,
        "create_embedded",
        {
          parentUuid: actor.uuid,
          documentType: "Item",
          data: spellSource(fixture, entry.id),
        },
      );
    if (
      fixture.category === "prepared" &&
      !fixture.pool &&
      fixture.slug !== "prepared"
    ) {
      if (!state.stages[`${prefix}.slots`])
        await mutate(client, state, `${prefix}.slots`, "update_document", {
          uuid: entry.uuid,
          data: {
            system: {
              slots: {
                [`slot${fixture.rank}`]: {
                  prepared: [{ id: spell.id, expended: false }],
                  value: fixture.pool ? 2 : 0,
                  max: 1,
                },
              },
            },
          },
        });
    }
    let token = state.stages[`${prefix}.token`]?.result;
    if (!token)
      token = await mutate(
        client,
        state,
        `${prefix}.token`,
        "create_embedded",
        {
          parentUuid: scene.uuid,
          documentType: "Token",
          data: {
            name: `${fixturePrefix} ${prefix}`,
            actorId: actor.id,
            actorLink: true,
            x: 150 + fixtures.indexOf(fixture) * 150,
            y: 200,
            width: 1,
            height: 1,
            hidden: true,
            disposition: -1,
          },
        },
      );
    state.fixtures[prefix] = {
      actor,
      entry,
      spell,
      caster: token,
      rank: fixture.rank,
      category: fixture.category,
      slotId: fixture.pool ? null : 0,
    };
    await save(state);
  }
}
async function readCall(client, name, args) {
  const result = parseText(
    await client.callTool({ name, arguments: args }, undefined, {
      timeout: 90_000,
    }),
  );
  if (!result.ok)
    throw new Error(`${name} failed: ${result.error?.code ?? "UNKNOWN"}`);
  return result.data;
}
async function verifyFixture(client, state, slug) {
  const f = state.fixtures[slug];
  if (
    !f ||
    !f.actor?.uuid ||
    !f.entry?.uuid ||
    !f.spell?.uuid ||
    !f.caster?.uuid
  )
    throw new Error(
      `Fixture ${slug} is missing confirmed stage references; refusing to reconstruct it.`,
    );
  const [scene, actor, entry, spell, caster] = await Promise.all([
    readCall(client, "get_document", { uuid: state.stages.scene.result.uuid }),
    readCall(client, "get_document", { uuid: f.actor.uuid }),
    readCall(client, "get_document", { uuid: f.entry.uuid }),
    readCall(client, "get_document", { uuid: f.spell.uuid }),
    readCall(client, "get_document", { uuid: f.caster.uuid }),
  ]);
  const documents = [scene, actor, entry, spell, caster];
  if (documents.some((doc) => !doc || typeof doc.uuid !== "string"))
    throw new Error(`Fixture ${slug} no longer resolves to world documents.`);
  if (
    !scene.name?.startsWith(fixturePrefix) ||
    !actor.name?.startsWith(fixturePrefix) ||
    !entry.name?.startsWith(fixturePrefix) ||
    !caster.name?.startsWith(fixturePrefix) ||
    !actor.items?.some((item) => item._id === f.entry.id) ||
    !actor.items?.some((item) => item._id === f.spell.id) ||
    spell.system?.location?.value !== f.entry.id ||
    caster.actorId !== f.actor.id ||
    !caster.uuid.startsWith(`${scene.uuid}.Token.`)
  )
    throw new Error(
      `Fixture ${slug} identity, ownership, or named parent does not match progress; no mutation attempted.`,
    );
  return { scene, actor, entry, spell, caster };
}
async function verifyCard(client, state, slug) {
  const key = `${slug}.live.card`;
  const fixture = state.fixtures[slug];
  const cast = state.checks[`${slug}.live.cast`]?.cast;
  if (!cast || cast.state !== "confirmed" || !cast.chatMessageUuid)
    throw new Error(
      `Fixture ${slug} has no confirmed saved cast/card; no replay.`,
    );
  const card = await readCall(client, "get_document", {
    uuid: cast.chatMessageUuid,
  });
  const flags = card.flags?.pf2e;
  const checks = {
    actualCastMarker:
      flags?.origin?.rollOptions?.includes(
        "origin:action:slug:cast-a-spell",
      ) === true,
    explicitSpeaker:
      card.speaker?.scene === fixture.caster.uuid.split(".")[1] &&
      card.speaker?.token === fixture.caster.id &&
      card.speaker?.actor === fixture.actor.id,
    gmVisibility:
      Array.isArray(card.whisper) &&
      card.whisper.length > 0 &&
      card.blind !== true,
    cardOrigin: flags?.origin?.uuid === fixture.spell.uuid,
    entryOrigin: flags?.casting?.id === fixture.entry.id,
    bridgeCastId:
      card.flags?.["foundry-vtt-mcp"]?.spellCast?.castId === cast.castId,
  };
  if (Object.values(checks).some((value) => value !== true)) {
    state.checks[key] = { status: "failed", checks };
    await save(state);
    throw new Error(
      `Native card verification failed for ${slug}; preserve native records.`,
    );
  }
  state.checks[key] = { status: "complete", checks };
  await save(state);
}
function validCastResult(cast, selection, preview, actorUuid) {
  const before = cast?.resourceBefore;
  const after = cast?.resourceAfter;
  const transition =
    before?.kind === "none"
      ? JSON.stringify(before) === JSON.stringify(after)
      : before?.kind === "preparedSlot"
        ? before.expended === false && after?.expended === true
        : Number.isSafeInteger(before?.value) &&
          after?.value === before.value - before.cost;
  return (
    cast?.cast === "confirmed" &&
    cast.castId === preview.castId &&
    cast.actorUuid === actorUuid &&
    cast?.spellUuid === selection.spellUuid &&
    cast.rank === selection.rank &&
    cast.slotId === selection.slotId &&
    cast.messageMode === selection.messageMode &&
    typeof cast.chatMessageUuid === "string" &&
    cast.chatMessageUuid.length > 0 &&
    transition &&
    JSON.stringify(cast.resourceBefore) ===
      JSON.stringify(preview.resourceBefore)
  );
}
async function runCastingChecks(client, state) {
  const results = state.checks ?? (state.checks = {});
  await save(state);
  for (const fixture of fixtures) {
    const subject = state.fixtures[fixture.slug];
    const key = `${fixture.slug}.live`;
    await verifyFixture(client, state, fixture.slug);
    if (results[key]?.status === "complete") {
      await verifyCard(client, state, fixture.slug);
      const id = `${key}.cast`;
      const duplicateKey = `${key}.duplicate`;
      if (results[duplicateKey]?.status !== "rejected")
        throw new Error(
          `Saved duplicate result for ${fixture.slug} is not a confirmed rejection.`,
        );
      const staleKey = `${key}.staleSelection`;
      if (results[staleKey]?.status === "in_flight")
        throw new Error(`${staleKey} outcome is uncertain; no replay.`);
      if (!results[staleKey]) {
        results[staleKey] = { status: "in_flight" };
        await save(state);
        const prior = results[id];
        const stale = parseText(
          await client.callTool({
            name: "pf2e_cast_spell",
            arguments: {
              ...prior.selection,
              rank: prior.selection.rank === 10 ? 9 : prior.selection.rank + 1,
              castId: prior.preview.castId,
              reviewToken: prior.preview.reviewToken,
              expectedCombat: prior.preview.expectedCombat,
            },
          }),
        );
        results[staleKey] = {
          status: stale.ok ? "unexpected_success" : "rejected",
          code: stale.error?.code ?? null,
        };
        await save(state);
        if (stale.ok)
          throw new Error(
            `Altered selection unexpectedly succeeded for ${fixture.slug}.`,
          );
      }
      if (results[staleKey].status !== "rejected")
        throw new Error(
          `Altered selection was not rejected for ${fixture.slug}.`,
        );
      continue;
    }
    const inspection = await readCall(client, "pf2e_inspect_spellcasting", {
      targetUuid: subject.caster.uuid,
      offset: 0,
      limit: 100,
    });
    const resources = await readCall(client, "pf2e_inspect_resources", {
      targetUuid: subject.caster.uuid,
      offset: 0,
      limit: 100,
    });
    const option = inspection.options?.items?.find(
      (row) => row.spellUuid === subject.spell.uuid && row.available === true,
    );
    if (!option) {
      results[key] = {
        status: "blocked",
        inspection: {
          options: inspection.options?.length ?? 0,
          warnings: inspection.warnings?.length ?? 0,
        },
        resources: { entries: resources.entries?.length ?? 0 },
        reason: "No usable native option for the exact owned fixture spell.",
      };
      await save(state);
      console.log(
        JSON.stringify({
          fixture: fixture.slug,
          status: "blocked",
          reason: results[key].reason,
        }),
      );
      continue;
    }
    const selection = {
      casterTokenUuid: subject.caster.uuid,
      entryUuid: subject.entry.uuid,
      spellUuid: subject.spell.uuid,
      rank: option.rank,
      slotId: option.slotId,
      targetTokenUuids: [],
      messageMode: "gm",
    };
    const preview = await readCall(
      client,
      "pf2e_inspect_spell_cast",
      selection,
    );
    const id = `${key}.cast`;
    if (results[id]?.status === "uncertain")
      throw new Error(
        `${id} needs manual reconciliation; refusing another cast.`,
      );
    if (results[id]?.status !== "complete") {
      results[id] = {
        status: "in_flight",
        selection,
        preview: {
          castId: preview.castId,
          reviewToken: preview.reviewToken,
          expectedCombat: preview.expectedCombat,
          resourceBefore: preview.resourceBefore,
        },
      };
      await save(state);
      let cast;
      try {
        cast = await readCall(client, "pf2e_cast_spell", {
          ...selection,
          castId: preview.castId,
          reviewToken: preview.reviewToken,
          expectedCombat: preview.expectedCombat,
        });
      } catch (error) {
        results[id].status = "uncertain";
        results[id].error = String(error).slice(0, 300);
        await save(state);
        throw new Error(
          `${id} outcome is uncertain. Inspect native resources, chat and ledger before any manual reconciliation.`,
        );
      }
      if (!validCastResult(cast, selection, preview, subject.actor.uuid)) {
        results[id].status = "uncertain";
        results[id].error =
          "Native cast response did not match the inspected selection/resource transition/card identity.";
        await save(state);
        throw new Error(
          `${id} returned mismatched post-write facts; no replay.`,
        );
      }
      results[id] = {
        status: "complete",
        selection,
        preview: results[id].preview,
        cast: {
          state: cast.cast,
          castId: cast.castId,
          resourceBefore: cast.resourceBefore,
          resourceAfter: cast.resourceAfter,
          chatMessageUuid: cast.chatMessageUuid,
          actorUuid: cast.actorUuid,
          spellUuid: cast.spellUuid,
          rank: cast.rank,
          slotId: cast.slotId,
          messageMode: cast.messageMode,
        },
      };
      await save(state);
      console.log(
        JSON.stringify({
          fixture: fixture.slug,
          status: "cast",
          result: results[id].cast,
        }),
      );
    }
    const duplicateKey = `${key}.duplicate`;
    if (results[duplicateKey]?.status === "in_flight")
      throw new Error(
        `${duplicateKey} outcome is uncertain; inspect ledger before resuming.`,
      );
    if (!results[duplicateKey]) {
      results[duplicateKey] = {
        status: "in_flight",
        castId: results[id].preview.castId,
      };
      await save(state);
      const duplicate = parseText(
        await client.callTool({
          name: "pf2e_cast_spell",
          arguments: {
            ...selection,
            castId: results[id].preview.castId,
            reviewToken: results[id].preview.reviewToken,
            expectedCombat: results[id].preview.expectedCombat,
          },
        }),
      );
      results[duplicateKey] = {
        status: duplicate.ok ? "unexpected_success" : "rejected",
        code: duplicate.error?.code ?? null,
      };
      await save(state);
      if (duplicate.ok)
        throw new Error(
          `Duplicate cast unexpectedly succeeded for ${fixture.slug}.`,
        );
    }
    const staleKey = `${key}.staleSelection`;
    if (results[staleKey]?.status === "in_flight")
      throw new Error(`${staleKey} outcome is uncertain; no replay.`);
    if (!results[staleKey]) {
      results[staleKey] = { status: "in_flight" };
      await save(state);
      const stale = parseText(
        await client.callTool({
          name: "pf2e_cast_spell",
          arguments: {
            ...results[id].selection,
            rank:
              results[id].selection.rank === 10
                ? 9
                : results[id].selection.rank + 1,
            castId: results[id].preview.castId,
            reviewToken: results[id].preview.reviewToken,
            expectedCombat: results[id].preview.expectedCombat,
          },
        }),
      );
      results[staleKey] = {
        status: stale.ok ? "unexpected_success" : "rejected",
        code: stale.error?.code ?? null,
      };
      await save(state);
      if (stale.ok)
        throw new Error(
          `Altered cast selection unexpectedly succeeded for ${fixture.slug}.`,
        );
    }
    if (results[staleKey].status !== "rejected")
      throw new Error(
        `Altered cast selection was not rejected for ${fixture.slug}.`,
      );
    await verifyCard(client, state, fixture.slug);
    results[key] = {
      status: "complete",
      option: {
        rank: option.rank,
        slotId: option.slotId,
        groupNumber: option.groupNumber,
        resource: option.resource,
      },
      resourceEntries: resources.entries?.length ?? 0,
      duplicate: results[duplicateKey].status,
    };
    await save(state);
  }
}
async function main() {
  const mode = process.argv[2] ?? "probe";
  if (!["probe", "fixture"].includes(mode))
    throw new Error(
      "Usage: node scripts/live-v091-spellcasting.mjs <probe|fixture>",
    );
  if (
    mode === "fixture" &&
    process.env.FOUNDRY_MCP_LIVE_ACCEPTANCE !== "I_ACCEPT_NAMED_FIXTURE_WRITES"
  ) {
    throw new Error(
      "Fixture mode requires FOUNDRY_MCP_LIVE_ACCEPTANCE=I_ACCEPT_NAMED_FIXTURE_WRITES.",
    );
  }
  const state = await load();
  assertNoPendingWork(state);
  const client = new Client({
    name: "foundry-mcp-v091-live-acceptance",
    version: "0.9.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "packages/companion/dist/cli.js"), "mcp"],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    const names = listing.tools.map((tool) => tool.name);
    const status = parseText(
      await client.callTool({ name: "get_status", arguments: {} }),
    );
    if (!status.ok || !status.data?.connected)
      throw new Error("Connected Foundry bridge is required.");
    if (
      status.data.systemId !== "pf2e" ||
      status.data.systemVersion !== "8.7.0"
    )
      throw new Error("Expected connected PF2e 8.7.0 world.");
    const versions = status.data.versionDiagnostics?.versions ?? {};
    const versionKeys = [
      "compiledModule",
      "installedModuleManifest",
      "runningCompanion",
      "mcpClient",
      "mcpServer",
    ];
    if (versionKeys.some((key) => versions[key] !== expectedVersion))
      throw new Error(
        `All five runtime versions must report ${expectedVersion}.`,
      );
    if (mode === "fixture")
      validateProgressBinding(state, status.data.worldId, expectedVersion);
    const required = [
      "create_document",
      "create_embedded",
      "update_document",
      "pf2e_inspect_spellcasting",
      "pf2e_inspect_resources",
      "pf2e_inspect_spell_cast",
      "pf2e_cast_spell",
    ];
    if (required.some((name) => !names.includes(name)))
      throw new Error("Fresh MCP discovery is missing required v0.9 tools.");
    const result = {
      at: new Date().toISOString(),
      worldId: status.data.worldId,
      foundryVersion: status.data.foundryVersion,
      systemVersion: status.data.systemVersion,
      versions,
      expectedVersion,
      toolCount: names.length,
      writeMode: status.data.writeMode,
    };
    if (mode === "probe") {
      const pf2e = parseText(
        await client.callTool({ name: "pf2e_status", arguments: {} }),
      );
      result.pf2eStatus = {
        ok: pf2e.ok,
        available: pf2e.data?.available,
        enabled: pf2e.data?.enabled,
      };
      result.readOnly = true;
      console.log(JSON.stringify(result));
      return;
    }
    if (status.data.writeMode !== "automatic")
      throw new Error(
        "Fixture run expects already authorized automatic writes; do not change authorization automatically.",
      );
    const progress = {
      ...state,
      environment: result,
      fixturePrefix,
      fixtures: state.fixtures ?? {},
      stages: state.stages,
    };
    await save(progress);
    await createFixtures(client, progress);
    await runCastingChecks(client, progress);
    console.log(
      JSON.stringify({
        ...result,
        statePath,
        fixtures: Object.keys(progress.fixtures),
        note: "Named fixture state is checkpointed; completed casts are verified read-only and never replayed.",
      }),
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

export {
  assertNoPendingWork,
  validCastResult,
  validateProgressBinding,
  validateWriteResult,
};
