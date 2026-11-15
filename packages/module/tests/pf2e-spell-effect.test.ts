import { describe, expect, it, vi } from "vitest";
import { handlePF2eSpellEffect } from "../src/pf2e-spell-effect.js";
import { writeTools, parseTool, toolNames } from "@foundry-mcp/shared";
import { spellEffectSemanticKey } from "../src/pf2e-spell-effect-ledger.js";
import { handlePF2eSpellAudit } from "../src/pf2e-spell-audit.js";

function fixture() {
  const worldId = "world-1", userId = "gm-1", sessionId = "session-1";
  function doc(data: any) {
    return {
      ...data,
      toObject() { return structuredClone(data.source ?? { _id: this.id, name: this.name, type: this.type, system: this.system ?? {}, flags: this.flags ?? {} }); },
    };
  }
  const scene: any = { id: "scene-1", uuid: "Scene.scene-1", documentName: "Scene", tokens: new Map(), toObject: () => ({ _id: "scene-1" }) };
  const caster: any = doc({ id: "caster", uuid: "Actor.caster", documentName: "Actor", type: "character", name: "Caster", parent: null, system: { level: { value: 5 } } });
  const targetActor: any = doc({ id: "target", uuid: "Actor.target", documentName: "Actor", type: "npc", name: "Target", parent: null, system: {} });
  const casterToken: any = doc({ id: "caster-token", uuid: "Scene.scene-1.Token.caster-token", documentName: "Token", parent: scene, actor: caster });
  const targetToken: any = doc({ id: "target-token", uuid: "Scene.scene-1.Token.target-token", documentName: "Token", parent: scene, actor: targetActor });
  scene.tokens.set(casterToken.id, casterToken);
  scene.tokens.set(targetToken.id, targetToken);
  const entry: any = doc({ id: "entry", uuid: "Actor.caster.Item.entry", documentName: "Item", type: "spellcastingEntry", actor: caster, parent: caster, isRitual: false, isEphemeral: false, system: {} });
  const spell: any = doc({ id: "spell", uuid: "Actor.caster.Item.spell", documentName: "Item", type: "spell", actor: caster, parent: caster, system: { location: { value: entry.id }, level: { value: 1 } } });
  entry.spells = new Map([[spell.id, spell]]);
  caster.items = new Map([[entry.id, entry], [spell.id, spell]]);
  caster.spellcasting = { regular: [entry] };
  targetActor.items = new Map();
  targetActor.createEmbeddedDocuments = vi.fn();
  targetActor.conditions = { contents: [] };
  targetActor.itemTypes = { effect: [] };
  targetActor.getCondition = vi.fn((slug: string, options?: any) => {
    const matches = targetActor.conditions.contents.filter((item: any) => item.slug === slug);
    return options?.all ? matches : matches.find((item: any) => item.active === true) ?? null;
  });
  targetActor.increaseCondition = vi.fn();
  const castMessageUuid = "ChatMessage.cast-1";
  const castRecord: any = {
    castId: "cast-1", worldId, userId, sessionId, actorUuid: caster.uuid, casterTokenUuid: casterToken.uuid,
    entryUuid: entry.uuid, spellUuid: spell.uuid, rank: 1, slotId: null, targetTokenUuids: [targetToken.uuid],
    messageMode: "gm", reviewToken: "cast-secret", fingerprint: "a".repeat(64),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "confirmed", nativeConsumed: true,
    resourceBefore: { kind: "none", cost: 0, value: null, max: null, expended: null, groupNumber: null, slotId: null },
    resourceAfter: { kind: "none", cost: 0, value: null, max: null, expended: null, groupNumber: null, slotId: null },
    chatMessageUuid: castMessageUuid,
  };
  const castMessage: any = {
    id: "cast-1", uuid: castMessageUuid, documentName: "ChatMessage", speaker: { scene: scene.id, token: casterToken.id, actor: caster.id },
    whisper: [userId], blind: false,
    flags: {
      pf2e: { origin: { uuid: spell.uuid, castRank: 1, variant: { overlays: [] }, rollOptions: ["origin:action:slug:cast-a-spell"] }, casting: { id: entry.id } },
      "foundry-vtt-mcp": { spellCast: { castId: castRecord.castId, targetTokenUuids: castRecord.targetTokenUuids } },
    },
    toObject() { return { _id: this.id, speaker: structuredClone(this.speaker), whisper: [...this.whisper], blind: this.blind, flags: structuredClone(this.flags) }; },
  };
  const messages = new Map([[castMessage.id, castMessage]]);
  const pack: any = { collection: "pf2e.spell-effects", metadata: { system: "pf2e" }, get: vi.fn((id: string) => id === "bless" ? effectSource : null) };
  const effectSource = doc({ id: "bless", uuid: "Compendium.pf2e.spell-effects.Item.bless", documentName: "Item", type: "effect", name: "Blessed", slug: "blessed", compendium: pack, pack: pack.collection, parent: null, system: { duration: { value: 1, unit: "minutes", expiry: "turn-start", sustained: false }, traits: { value: ["magical"] }, rules: [] }, flags: { pf2e: { itemGrants: {} } } });
  let importMechanics: any = { name: "Blessed", type: "effect", system: structuredClone(effectSource.system), flags: structuredClone(effectSource.flags), _stats: { compendiumSource: effectSource.uuid } };
  const imported = vi.fn((_source: any, _options: any) => structuredClone(importMechanics));
  const conditionDefinition = (slug: string, valued: boolean) => doc({ id: slug, uuid: `Compendium.pf2e.conditionitems.Item.${slug}`, documentName: "Item", type: "condition", slug, name: slug[0].toUpperCase() + slug.slice(1), system: { value: { isValued: valued, value: valued ? 1 : null } } });
  const manager = {
    getCondition: vi.fn((slug: string) => slug === "frightened" ? conditionDefinition(slug, true) : slug === "blinded" ? conditionDefinition(slug, false) : null),
    updateConditionValue: vi.fn(),
  };
  const stored: Record<string, any> = { spellCasts: { version: 1, entries: { [castRecord.castId]: castRecord } } };
  const ctx: any = {
    sessionId, assertWrite: vi.fn(), serialize: (value: any) => value,
    resolve: vi.fn(async (uuid: string) => ({
      [castMessageUuid]: castMessage,
      [casterToken.uuid]: casterToken,
      [targetToken.uuid]: targetToken,
      [entry.uuid]: entry,
      [spell.uuid]: spell,
      [effectSource.uuid]: effectSource,
      [caster.uuid]: caster,
      [targetActor.uuid]: targetActor,
    } as any)[uuid] ?? Array.from(targetActor.items.values()).find((item: any) => item.uuid === uuid) ?? null),
    game: {
      world: { id: worldId }, user: { id: userId, isGM: true }, system: { id: "pf2e" },
      users: new Map([[userId, { id: userId, isGM: true }]]),
      pf2e: { ConditionManager: manager }, settings: {
        get: vi.fn((_module: string, key: string) => key === "pf2eEnabled" ? true : stored[key]),
        set: vi.fn(async (_module: string, key: string, value: any) => { stored[key] = structuredClone(value); }),
      },
      actors: new Map([[caster.id, caster], [targetActor.id, targetActor]]),
      scenes: new Map([[scene.id, scene]]), packs: new Map([[pack.collection, pack]]),
      messages,
      items: { fromCompendium: imported },
    },
  };
  const selection = (choice: any = { kind: "condition", slug: "frightened", value: 2 }) => ({
    castMessageUuid, casterTokenUuid: casterToken.uuid, targetTokenUuid: targetToken.uuid, choice,
  });
  function setCombat({ round = 1, turn = 0, token = casterToken, scene: combatScene = scene, started = true } = {}) {
    const combatant = { id: "combatant-1", uuid: "Combat.c.Combatant.1", token, tokenUuid: token.uuid };
    const combat: any = { id: "combat-1", uuid: "Combat.combat-1", documentName: "Combat", started, isActive: true, scene: combatScene, round, turn, combatant, turns: [combatant], combatants: new Map([[combatant.id, combatant]]) };
    ctx.game.combat = combat;
    ctx.game.combats = new Map([[combat.id, combat]]);
    return combat;
  }
  return { ctx, selection, caster, casterToken, targetActor, targetToken, scene, castMessage, castRecord, manager, imported, pack, effectSource,
    setImport: (value: any) => { importMechanics = value; }, setLedger: (value: any) => { stored.spellEffectOutcomes = value; }, setCombat };
}

async function makeUncertainEffect(prepare?: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture();
  prepare?.(f);
  const preview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection({ kind: "effect", uuid: f.effectSource.uuid }), f.ctx);
  let created: any;
  f.targetActor.createEmbeddedDocuments.mockImplementation(async (_type: string, data: any[]) => {
    const source = data[0];
    created = {
      ...structuredClone(source), id: "bless-after-lost-outcome", uuid: `${f.targetActor.uuid}.Item.bless-after-lost-outcome`,
      documentName: "Item", parent: f.targetActor, sourceId: source._stats.compendiumSource,
      toObject() { return { type: this.type, system: structuredClone(this.system), flags: structuredClone(this.flags), _stats: structuredClone(this._stats) }; },
    };
    f.targetActor.items.set(created.id, created);
    throw new Error("native creation acknowledgement lost");
  });
  await expect(handlePF2eSpellEffect("pf2e_apply_spell_effect", {
    ...preview.selection, applicationId: preview.applicationId, reviewToken: preview.reviewToken, expectedCombat: preview.expectedCombat,
  }, f.ctx)).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
  return { f, preview, created };
}

describe("PF2e spell-effect preview and duration inspection", () => {
  it("declares read-only preview/duration tools and approved write apply with strict choices", () => {
    expect(toolNames).toContain("pf2e_inspect_spell_effect");
    expect(toolNames).toContain("pf2e_inspect_spell_durations");
    expect(writeTools.has("pf2e_inspect_spell_effect")).toBe(false);
    expect(writeTools.has("pf2e_inspect_spell_durations")).toBe(false);
    expect(writeTools.has("pf2e_apply_spell_effect")).toBe(true);
    const valid = parseTool("pf2e_inspect_spell_effect", {
      castMessageUuid: "ChatMessage.cast-1", casterTokenUuid: "Scene.s.Token.a", targetTokenUuid: "Scene.s.Token.b",
      choice: { kind: "condition", slug: "frightened", value: 2 },
    });
    expect(valid.tool).toBe("pf2e_inspect_spell_effect");
    expect(() => parseTool("pf2e_inspect_spell_effect", {
      castMessageUuid: "ChatMessage.cast-1", casterTokenUuid: "Scene.s.Token.a", targetTokenUuid: "Scene.s.Token.b",
      choice: { kind: "effect", uuid: "Compendium.pf2e.Item.x", duration: 10 },
    })).toThrow();
    expect(() => parseTool("pf2e_inspect_spell_durations", { targetUuid: "Actor.a", limit: 51 })).toThrow();
  });

  it("previews a strict condition choice with exact source binding, short TTL and native current-turn snapshot", async () => {
    const f = fixture();
    const combat = f.setCombat();
    const result: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection(), f.ctx);
    expect(result).toMatchObject({
      choice: { kind: "condition", slug: "frightened", requestedValue: 2, expectedOperation: "increaseCondition" },
      expectedOperation: "create-condition",
      expectedCombat: { encounterUuid: combat.uuid, round: 1, turn: 0, combatantUuid: combat.combatant.uuid },
      targetActorUuid: f.targetActor.uuid,
      ledger: { available: true, recordCount: 0, remaining: 5000 },
    });
    expect(result.applicationId).toMatch(/^spell-effect-application-/);
    expect(result.reviewToken).toMatch(/^spell-effect-review-/);
    expect(Date.parse(result.expiresAt) - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(result).not.toHaveProperty("sourceFacts");
    expect(JSON.stringify(result)).not.toContain("cast-secret");
    expect(f.ctx.assertWrite).not.toHaveBeenCalled();
  });

  it("previews an exact PF2e compendium root effect and binds converted source mechanics", async () => {
    const f = fixture();
    const result: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection({ kind: "effect", uuid: "Compendium.pf2e.spell-effects.Item.bless" }), f.ctx);
    expect(result.choice).toMatchObject({ kind: "effect", uuid: "Compendium.pf2e.spell-effects.Item.bless", duration: { unit: "minutes", value: 1 } });
    expect(f.imported).toHaveBeenCalledWith(expect.objectContaining({ type: "effect" }), {
      keepId: false, clearOwnership: true, clearFolder: true, clearSort: true, clearState: true,
    });
    expect(f.ctx.assertWrite).not.toHaveBeenCalled();
  });

  it("applies the reviewed effect through native Actor creation with truthful PF2e context and durable audit", async () => {
    const f = fixture();
    const preview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection({ kind: "effect", uuid: f.effectSource.uuid }), f.ctx);
    f.targetActor.createEmbeddedDocuments.mockImplementation(async (_type: string, data: any[]) => {
      const source = data[0];
      const item: any = {
        ...structuredClone(source), id: "bless-applied", uuid: `${f.targetActor.uuid}.Item.bless-applied`,
        documentName: "Item", parent: f.targetActor, sourceId: source._stats.compendiumSource,
        toObject() { return { type: this.type, system: structuredClone(this.system), flags: structuredClone(this.flags), _stats: structuredClone(this._stats) }; },
      };
      f.targetActor.items.set(item.id, item);
      const grant: any = { id: "native-grant", uuid: `${f.targetActor.uuid}.Item.native-grant`, documentName: "Item", type: "effect", parent: f.targetActor, system: {}, flags: {}, toObject: () => ({ type: "effect", system: {}, flags: {} }) };
      f.targetActor.items.set(grant.id, grant);
      return [item, grant];
    });
    const result: any = await handlePF2eSpellEffect("pf2e_apply_spell_effect", {
      ...preview.selection, applicationId: preview.applicationId, reviewToken: preview.reviewToken, expectedCombat: preview.expectedCombat,
    }, f.ctx);
    expect(result).toMatchObject({ status: "confirmed", observedTargetDocumentCount: 2, reportedDocumentCount: 2, observedDocumentsTruncated: false, additionalObservedDocuments: 1 });
    expect(result.note).toMatch(/observed during the operation/);
    const item = f.targetActor.items.get("bless-applied");
    expect(item.system.context).toEqual({
      origin: { actor: f.caster.uuid, token: f.casterToken.uuid, item: "Actor.caster.Item.spell", spellcasting: null, rollOptions: ["origin:action:slug:cast-a-spell"] },
      target: { actor: f.targetActor.uuid, token: f.targetToken.uuid }, roll: null,
    });
    expect(item.flags["foundry-vtt-mcp"].spellEffectApplication).toMatchObject({ applicationId: preview.applicationId, sourceUuid: f.effectSource.uuid, reviewFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const ledger: any = f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes");
    expect(Object.values(ledger.entries)[0]).toMatchObject({ status: "confirmed", outcome: { kind: "effect-created", documentUuids: [item.uuid, "Actor.target.Item.native-grant"] } });
    expect(f.ctx.assertWrite).toHaveBeenCalledTimes(3); // reserve, native create, terminal ledger append
  });

  it("allows native embedded-item source changes for a self-targeted effect while retaining the cast context", async () => {
    const f = fixture();
    f.castRecord.targetTokenUuids = [f.casterToken.uuid];
    f.castMessage.flags["foundry-vtt-mcp"].spellCast.targetTokenUuids = [f.casterToken.uuid];
    f.caster.toObject = () => ({ _id: f.caster.id, name: f.caster.name, system: structuredClone(f.caster.system), flags: {},
      items: [...f.caster.items.values()].map((item: any) => item.toObject()), _stats: { modifiedTime: f.caster.items.size } });
    f.casterToken.toObject = () => ({ _id: f.casterToken.id, actorId: f.caster.id, actorLink: true, x: 10, y: 20,
      delta: { items: [...f.caster.items.values()].map((item: any) => item.toObject()), _stats: { modifiedTime: f.caster.items.size } } });
    const selection = { ...f.selection({ kind: "effect", uuid: f.effectSource.uuid }), targetTokenUuid: f.casterToken.uuid };
    const preview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", selection, f.ctx);
    f.caster.createEmbeddedDocuments = vi.fn(async (_type: string, data: any[]) => {
      const source = data[0];
      const item: any = { ...structuredClone(source), id: "self-effect", uuid: `${f.caster.uuid}.Item.self-effect`, documentName: "Item",
        parent: f.caster, sourceId: source._stats.compendiumSource,
        toObject() { return { type: this.type, system: structuredClone(this.system), flags: structuredClone(this.flags), _stats: structuredClone(this._stats) }; } };
      f.caster.items.set(item.id, item);
      return [item];
    });
    const result: any = await handlePF2eSpellEffect("pf2e_apply_spell_effect", {
      ...preview.selection, applicationId: preview.applicationId, reviewToken: preview.reviewToken, expectedCombat: preview.expectedCombat,
    }, f.ctx);
    expect(result.status).toBe("confirmed");
    expect(f.caster.items.has("self-effect")).toBe(true);
  });

  it("allows native synthetic Actor and Token delta item changes for a condition while preserving token placement", async () => {
    const f = fixture();
    f.targetActor.parent = f.targetToken;
    f.targetActor.isEmbedded = true;
    f.targetToken.toObject = () => ({ _id: f.targetToken.id, actorId: f.targetActor.id, actorLink: false, x: 30, y: 40,
      delta: { items: [...f.targetActor.items.values()].map((item: any) => item.toObject()), _stats: { modifiedTime: f.targetActor.items.size } },
      _stats: { modifiedTime: f.targetActor.items.size } });
    f.targetActor.toObject = () => ({ _id: f.targetActor.id, name: f.targetActor.name, system: structuredClone(f.targetActor.system), flags: {},
      items: [...f.targetActor.items.values()].map((item: any) => item.toObject()), _stats: { modifiedTime: f.targetActor.items.size } });
    f.targetActor.increaseCondition.mockImplementation(async (slug: string, options: any) => {
      const value = options.value ?? null;
      const row: any = { id: slug, uuid: `${f.targetActor.uuid}.Item.${slug}`, documentName: "Item", type: "condition", slug,
        active: true, value, system: { value: { value } }, parent: f.targetActor,
        toObject() { return { type: this.type, slug: this.slug, system: structuredClone(this.system), flags: {} }; } };
      f.targetActor.conditions.contents.push(row);
      f.targetActor.items.set(row.id, row);
      return row;
    });
    const preview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection(), f.ctx);
    const result: any = await handlePF2eSpellEffect("pf2e_apply_spell_effect", {
      ...preview.selection, applicationId: preview.applicationId, reviewToken: preview.reviewToken, expectedCombat: preview.expectedCombat,
    }, f.ctx);
    expect(result).toMatchObject({ status: "confirmed", outcome: { kind: "condition-created", observedValue: 2 } });
    expect(f.targetActor.getCondition("frightened")).toBe(f.targetActor.items.get("frightened"));
  });

  it("uses the exact native condition APIs for create, exact increase, and audited no-op", async () => {
    const created = fixture();
    created.targetActor.increaseCondition.mockImplementation(async (_slug: string, options: any) => {
      const value = options.value ?? null;
      const row: any = { id: "frightened", uuid: "Actor.target.Item.frightened", documentName: "Item", type: "condition", slug: "frightened", active: true, value, system: { value: { value } }, parent: created.targetActor };
      created.targetActor.conditions.contents.push(row);
      created.targetActor.items.set(row.id, row);
      return row;
    });
    const preview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", created.selection(), created.ctx);
    const result: any = await handlePF2eSpellEffect("pf2e_apply_spell_effect", { ...preview.selection, applicationId: preview.applicationId, reviewToken: preview.reviewToken, expectedCombat: preview.expectedCombat }, created.ctx);
    expect(result.status).toBe("confirmed");
    expect(created.targetActor.increaseCondition).toHaveBeenCalledWith("frightened", { value: 2, max: 2 });

    const increased = fixture();
    const current: any = { id: "frightened", uuid: "Actor.target.Item.frightened", documentName: "Item", type: "condition", slug: "frightened", active: true, value: 1, system: { value: { value: 1 } }, parent: increased.targetActor };
    increased.targetActor.conditions.contents.push(current); increased.targetActor.items.set(current.id, current);
    increased.manager.updateConditionValue.mockImplementation(async (_id: string, _actor: any, value: number) => { current.value = value; current.system.value.value = value; });
    const updatePreview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", increased.selection(), increased.ctx);
    await handlePF2eSpellEffect("pf2e_apply_spell_effect", { ...updatePreview.selection, applicationId: updatePreview.applicationId, reviewToken: updatePreview.reviewToken, expectedCombat: updatePreview.expectedCombat }, increased.ctx);
    expect(increased.manager.updateConditionValue).toHaveBeenCalledWith(current.id, increased.targetActor, 2);
    expect(increased.targetActor.increaseCondition).not.toHaveBeenCalled();

    const noop = fixture();
    const same: any = { id: "frightened", uuid: "Actor.target.Item.frightened", documentName: "Item", type: "condition", slug: "frightened", active: true, value: 2, system: { value: { value: 2 } }, parent: noop.targetActor };
    noop.targetActor.conditions.contents.push(same); noop.targetActor.items.set(same.id, same);
    const noopPreview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", noop.selection(), noop.ctx);
    const noopResult: any = await handlePF2eSpellEffect("pf2e_apply_spell_effect", { ...noopPreview.selection, applicationId: noopPreview.applicationId, reviewToken: noopPreview.reviewToken, expectedCombat: noopPreview.expectedCombat }, noop.ctx);
    expect(noopResult.outcome).toMatchObject({ kind: "already-satisfied", documentUuids: [same.uuid], observedValue: 2 });
    expect(noop.targetActor.increaseCondition).not.toHaveBeenCalled();
    expect(noop.manager.updateConditionValue).not.toHaveBeenCalled();
  });

  it("marks native-await card, target and turn changes uncertain without replay", async () => {
    for (const drift of ["card", "target", "turn"] as const) {
      const f = fixture();
      const combat = drift === "turn" ? f.setCombat() : null;
      const preview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection({ kind: "effect", uuid: f.effectSource.uuid }), f.ctx);
      f.targetActor.createEmbeddedDocuments.mockImplementation(async (_type: string, data: any[]) => {
        const source = data[0];
        const item: any = {
          ...structuredClone(source), id: "native-await-item", uuid: `${f.targetActor.uuid}.Item.native-await-item`,
          documentName: "Item", parent: f.targetActor, sourceId: source._stats.compendiumSource,
          toObject() { return { type: this.type, system: structuredClone(this.system), flags: structuredClone(this.flags), _stats: structuredClone(this._stats) }; },
        };
        f.targetActor.items.set(item.id, item);
        console.log("native drift", drift);
        if (drift === "card") f.castMessage.flags.pf2e.origin.castRank = 2;
        if (drift === "target") f.targetToken.actor = { ...f.targetActor, uuid: "Actor.replaced", documentName: "Actor" };
        if (drift === "turn") combat.round++;
        return [item];
      });
      await expect(handlePF2eSpellEffect("pf2e_apply_spell_effect", { ...preview.selection, applicationId: preview.applicationId, reviewToken: preview.reviewToken, expectedCombat: preview.expectedCombat }, f.ctx))
        .rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(f.targetActor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
      const ledger: any = f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes");
      expect(Object.values(ledger.entries)[0]).toMatchObject({ status: "uncertain", outcome: { kind: "effect-created" } });
    }
  });

  it("reconciles an uncertain effect only from its exact current native marker and preserves original history", async () => {
    const { f, preview, created } = await makeUncertainEffect();
    let ledger: any = f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes");
    expect(Object.values(ledger.entries)[0]).toMatchObject({ status: "uncertain", outcome: { kind: "effect-created", documentUuids: [created.uuid] } });

    const evidence: any = await handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: preview.applicationId }, f.ctx);
    expect(evidence).toMatchObject({ supported: true, decision: "confirmed-observed", sourceKind: "effect", sourceId: preview.applicationId });
    expect(evidence.effectEvidence).toMatchObject({ applicationId: preview.applicationId, targetActorUuid: f.targetActor.uuid,
      outcome: { kind: "effect-created", documentUuids: [created.uuid], observedValue: null } });
    expect(evidence.effectEvidence).not.toHaveProperty("nativeDocumentFacts");
    expect(JSON.stringify(evidence.effectEvidence)).not.toContain("cast-secret");
    const reconciled: any = await handlePF2eSpellAudit("pf2e_reconcile_spell_audit", { reconciliationId: evidence.reconciliationId, reviewToken: evidence.reviewToken }, f.ctx);
    expect(reconciled).toMatchObject({ reconciled: true, originalStatus: "uncertain", effectiveStatus: "reconciled" });
    const history: any = await handlePF2eSpellAudit("pf2e_inspect_spell_history", { kind: "effect", actorUuid: f.caster.uuid, limit: 10 }, f.ctx);
    expect(history.entries[0]).toMatchObject({
      kind: "effect", actorUuid: f.caster.uuid, targetActorUuid: f.targetActor.uuid,
      originalStatus: "uncertain", effectiveStatus: "reconciled", reconciliationDecision: "confirmed-observed",
      evidenceDocumentUuids: [created.uuid], evidenceOutcomeKind: "effect-created",
    });
    ledger = f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes");
    expect(Object.values(ledger.entries)[0]).toMatchObject({ status: "uncertain", outcome: { documentUuids: [created.uuid] } });
  });

  it("allows effect evidence recovery after reconnect and by another current GM without rewriting original session facts", async () => {
    const { f, preview } = await makeUncertainEffect((ctx) => {
      ctx.castRecord.messageMode = "public";
      ctx.castMessage.whisper = [];
    });
    const sourceBefore = structuredClone(f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes"));
    f.ctx.game.users.set("gm-2", { id: "gm-2", isGM: true });
    f.ctx.game.user = { id: "gm-2", isGM: true };
    f.ctx.sessionId = "session-after-reconnect";
    const review: any = await handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: preview.applicationId }, f.ctx);
    expect(review).toMatchObject({ supported: true, decision: "confirmed-observed" });
    const result: any = await handlePF2eSpellAudit("pf2e_reconcile_spell_audit", { reconciliationId: review.reconciliationId, reviewToken: review.reviewToken }, f.ctx);
    expect(result).toMatchObject({ reconciled: true, originalStatus: "uncertain", effectiveStatus: "reconciled" });
    expect(f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes")).toEqual(sourceBefore);
    expect(f.ctx.game.settings.get("foundry-vtt-mcp", "spellReconciliations").entries[review.reconciliationId].userId).toBe("gm-2");
  });

  it("rejects an effect review when the current session changes during evidence hashing", async () => {
    const { f, preview } = await makeUncertainEffect();
    const subtle = globalThis.crypto.subtle;
    const originalDigest = subtle.digest.bind(subtle);
    const digestSpy = vi.spyOn(subtle, "digest").mockImplementation(async (...args: Parameters<SubtleCrypto["digest"]>) => {
      const result = await originalDigest(...args);
      f.ctx.sessionId = "session-changed-during-hash";
      return result;
    });
    try {
      await expect(handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: preview.applicationId }, f.ctx))
        .rejects.toMatchObject({ code: "SPELL_RECONCILIATION_STALE" });
    } finally { digestSpy.mockRestore(); }
    expect(f.ctx.game.settings.set).not.toHaveBeenCalledWith("foundry-vtt-mcp", "spellReconciliations", expect.anything());
  });

  it("rejects a current-session change after review and before reconciliation append", async () => {
    const { f, preview } = await makeUncertainEffect();
    const review: any = await handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: preview.applicationId }, f.ctx);
    f.ctx.sessionId = "session-changed-before-append";
    await expect(handlePF2eSpellAudit("pf2e_reconcile_spell_audit", { reconciliationId: review.reconciliationId, reviewToken: review.reviewToken }, f.ctx))
      .rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(f.ctx.game.settings.set).not.toHaveBeenCalledWith("foundry-vtt-mcp", "spellReconciliations", expect.anything());
  });

  it("recovers a condition lost acknowledgement from the exact newly owned native condition and durable outcome", async () => {
    const f = fixture();
    f.targetActor.increaseCondition.mockImplementation(async (_slug: string, options: any) => {
      const value = options.value ?? null;
      const row: any = {
        id: "frightened", uuid: "Actor.target.Item.frightened", documentName: "Item", type: "condition",
        slug: "frightened", active: true, value, system: { value: { value } }, parent: f.targetActor,
        toObject() { return { _id: this.id, type: this.type, slug: this.slug, system: structuredClone(this.system) }; },
      };
      f.targetActor.conditions.contents.push(row); f.targetActor.items.set(row.id, row);
      throw new Error("native condition acknowledgement lost after creation");
    });
    const preview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection(), f.ctx);
    await expect(handlePF2eSpellEffect("pf2e_apply_spell_effect", { ...preview.selection, applicationId: preview.applicationId, reviewToken: preview.reviewToken, expectedCombat: preview.expectedCombat }, f.ctx)).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
    const ledger: any = f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes");
    expect(Object.values(ledger.entries)[0]).toMatchObject({ status: "uncertain", expectedOperation: "create-condition", outcome: { kind: "condition-created", observedValue: 2 } });
    const review: any = await handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: preview.applicationId }, f.ctx);
    expect(review).toMatchObject({ supported: true, decision: "confirmed-observed" });
    const result: any = await handlePF2eSpellAudit("pf2e_reconcile_spell_audit", { reconciliationId: review.reconciliationId, reviewToken: review.reviewToken }, f.ctx);
    expect(result).toMatchObject({ reconciled: true, originalStatus: "uncertain", effectiveStatus: "reconciled" });
    const history: any = await handlePF2eSpellAudit("pf2e_inspect_spell_history", { kind: "effect", actorUuid: f.caster.uuid, limit: 10 }, f.ctx);
    expect(history.entries[0]).toMatchObject({ originalStatus: "uncertain", effectiveStatus: "reconciled", evidenceOutcomeKind: "condition-created", evidenceObservedValue: 2 });
  });

  it("recovers a reserved effect only from its exact original application marker", async () => {
    const { f, preview, created } = await makeUncertainEffect();
    const ledger: any = f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes");
    const entry: any = Object.values(ledger.entries)[0];
    entry.status = "reserved";
    entry.outcome = null;
    f.setLedger(ledger);
    const review: any = await handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: preview.applicationId }, f.ctx);
    expect(review).toMatchObject({ supported: true, decision: "confirmed-observed" });
    const result: any = await handlePF2eSpellAudit("pf2e_reconcile_spell_audit", { reconciliationId: review.reconciliationId, reviewToken: review.reviewToken }, f.ctx);
    expect(result).toMatchObject({ reconciled: true, originalStatus: "reserved", effectiveStatus: "reconciled" });
    expect(review).not.toHaveProperty("reviewedSourceFacts");
    expect(created.flags["foundry-vtt-mcp"].spellEffectApplication.applicationId).toBe(preview.applicationId);
  });

  it("rejects stale card, context, marker, pack, Actor binding and recorded native grant evidence", async () => {
    const mutators: Array<[string, (f: ReturnType<typeof fixture>, created: any) => void]> = [
      ["cast card", (f) => { f.castMessage.flags.pf2e.origin.castRank = 2; }],
      ["native context", (_f, item) => { item.system.context.target.actor = "Actor.other"; }],
      ["application marker", (_f, item) => { item.flags["foundry-vtt-mcp"].spellEffectApplication.reviewFingerprint = "f".repeat(64); }],
      ["same-UUID pack replacement", (f) => { f.pack.get = () => ({ ...f.effectSource }); }],
      ["target Actor binding", (f) => { f.targetToken.actor = { ...f.targetActor, uuid: "Actor.replacement", documentName: "Actor" }; }],
    ];
    for (const [label, mutate] of mutators) {
      const { f, preview, created } = await makeUncertainEffect();
      mutate(f, created);
      const review: any = await handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: preview.applicationId }, f.ctx);
      expect(review.supported, label).toBe(false);
    }
    const missingGrant = await makeUncertainEffect();
    const grant: any = { id: "grant", uuid: `${missingGrant.f.targetActor.uuid}.Item.grant`, documentName: "Item", type: "effect", parent: missingGrant.f.targetActor, toObject: () => ({ type: "effect", system: {}, flags: {} }) };
    missingGrant.f.targetActor.items.set(grant.id, grant);
    const ledger: any = missingGrant.f.ctx.game.settings.get("foundry-vtt-mcp", "spellEffectOutcomes");
    const row: any = Object.values(ledger.entries)[0];
    row.outcome.documentUuids.push(grant.uuid);
    missingGrant.f.setLedger(ledger);
    missingGrant.f.targetActor.items.delete(grant.id);
    const missingGrantReview: any = await handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: missingGrant.preview.applicationId }, missingGrant.f.ctx);
    expect(missingGrantReview.supported).toBe(false);
  });

  it("rechecks the reviewed card, context, pack, Actor and document identities synchronously after evidence hashing", async () => {
    for (const drift of ["card", "context", "pack", "actor", "document"] as const) {
      const { f, preview, created } = await makeUncertainEffect();
      const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
      const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args: any[]) => {
        const result = await digest(args[0], args[1]);
        if (drift === "card") f.castMessage.flags.pf2e.origin.castRank = 2;
        if (drift === "context") created.system.context.origin.item = "Actor.caster.Item.replaced";
        if (drift === "pack") f.pack.get = () => ({ ...f.effectSource });
        if (drift === "actor") f.targetToken.actor = { ...f.targetActor, uuid: "Actor.replaced", documentName: "Actor" };
        if (drift === "document") f.targetActor.items.delete(created.id);
        return result;
      });
      try {
        await expect(handlePF2eSpellAudit("pf2e_inspect_spell_reconciliation", { kind: "effect", sourceId: preview.applicationId }, f.ctx)).rejects.toMatchObject({ code: "SPELL_RECONCILIATION_STALE" });
      } finally { spy.mockRestore(); }
    }
  });

  it("rejects unsupported source cards, card/target mismatch, restricted choices and invalid values", async () => {
    const wrongCard = fixture();
    wrongCard.castMessage.flags.pf2e.origin.castRank = 2;
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", wrongCard.selection(), wrongCard.ctx)).rejects.toMatchObject({ code: "INVALID_CAST_CARD" });
    const wrongTarget = fixture();
    wrongTarget.castMessage.flags["foundry-vtt-mcp"].spellCast.targetTokenUuids = [];
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", wrongTarget.selection(), wrongTarget.ctx)).rejects.toMatchObject({ code: "INVALID_CAST_CARD" });
    const badCondition = fixture();
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", badCondition.selection({ kind: "condition", slug: "persistent-damage", value: 2 }), badCondition.ctx)).rejects.toMatchObject({ code: "UNSUPPORTED_CONDITION" });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", badCondition.selection({ kind: "condition", slug: "blinded", value: 1 }), badCondition.ctx)).rejects.toMatchObject({ code: "INVALID_CONDITION_VALUE" });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", badCondition.selection({ kind: "condition", slug: "frightened", value: 0 }), badCondition.ctx)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("fails closed on malformed, already blocked, or full outcome ledgers during preview", async () => {
    const bad = fixture();
    bad.setLedger({ version: 99, entries: {} });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", bad.selection(), bad.ctx)).rejects.toMatchObject({ code: "SPELL_EFFECT_LEDGER_INVALID" });
    const blocked = fixture();
    const choice = { kind: "condition", slug: "frightened", value: 2 } as const;
    const semanticKey = spellEffectSemanticKey("ChatMessage.cast-1", "Actor.target", choice);
    const entry = {
      applicationId: "spell-effect-application-old", semanticKey, worldId: "world-1", userId: "gm-1", sessionId: "session-1",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), castMessageUuid: "ChatMessage.cast-1", castId: "cast-1",
      casterActorUuid: "Actor.caster", casterTokenUuid: blocked.casterToken.uuid, targetActorUuid: "Actor.target", targetTokenUuid: blocked.targetToken.uuid,
      choice, reviewFingerprint: "a".repeat(64), expectedOperation: "create-condition", beforeConditionUuid: null, beforeConditionValue: null,
      status: "uncertain", outcome: null,
    };
    blocked.setLedger({ version: 1, entries: { [semanticKey]: entry } });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", blocked.selection(), blocked.ctx)).rejects.toMatchObject({ code: "SPELL_EFFECT_ALREADY_RECORDED" });
    const full = fixture();
    const entries: Record<string, any> = {};
    for (let index = 0; index < 5000; index++) {
      const card = `ChatMessage.old-${index}`;
      const actorUuid = `Actor.old-${index}`;
      const key = spellEffectSemanticKey(card, actorUuid, { kind: "effect", uuid: "Compendium.pf2e.spell-effects.Item.other" });
      entries[key] = {
        ...entry,
        applicationId: `spell-effect-application-old-${index}`, semanticKey: key,
        castMessageUuid: card, castId: `cast-${index}`, targetActorUuid: actorUuid,
        choice: { kind: "effect", uuid: "Compendium.pf2e.spell-effects.Item.other" }, expectedOperation: "create-effect",
      };
    }
    full.setLedger({ version: 1, entries });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", full.selection(), full.ctx)).rejects.toMatchObject({ code: "SPELL_EFFECT_LEDGER_FULL" });
  });

  it("requires valid combat trackers and the caster's turn without imposing turns for duration reads", async () => {
    const invalidScene = fixture();
    invalidScene.setCombat({ scene: { id: "scene-other", documentName: "Scene" } as any });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", invalidScene.selection(), invalidScene.ctx)).rejects.toMatchObject({ code: "INVALID_COMBAT" });
    const negativeTurn = fixture();
    negativeTurn.setCombat({ turn: -1 });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", negativeTurn.selection(), negativeTurn.ctx)).rejects.toMatchObject({ code: "INVALID_COMBAT" });
    const outOfRange = fixture();
    outOfRange.setCombat({ turn: 2 });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", outOfRange.selection(), outOfRange.ctx)).rejects.toMatchObject({ code: "INVALID_COMBAT" });
    const staleTurn = fixture();
    staleTurn.setCombat({ token: staleTurn.targetToken });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", staleTurn.selection(), staleTurn.ctx)).rejects.toMatchObject({ code: "STALE_TURN" });
    const duration = fixture();
    duration.setCombat({ token: duration.targetToken });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_durations", { targetUuid: duration.targetActor.uuid }, duration.ctx)).resolves.toMatchObject({ actorUuid: duration.targetActor.uuid });
  });

  it("uses the native sorted combat tracker order rather than collection insertion order", async () => {
    const f = fixture();
    const casterRow: any = { id: "caster-row", uuid: "Combat.c.Combatant.caster", token: f.casterToken, tokenUuid: f.casterToken.uuid };
    const targetRow: any = { id: "target-row", uuid: "Combat.c.Combatant.target", token: f.targetToken, tokenUuid: f.targetToken.uuid };
    const combat: any = { id: "combat-1", uuid: "Combat.combat-1", documentName: "Combat", started: true, isActive: true, scene: f.scene, round: 1, turn: 0, combatant: casterRow, turns: [casterRow, targetRow], combatants: new Map([[targetRow.id, targetRow], [casterRow.id, casterRow]]) };
    f.ctx.game.combat = combat;
    f.ctx.game.combats = new Map([[combat.id, combat]]);
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection(), f.ctx)).resolves.toMatchObject({ expectedCombat: { combatantUuid: casterRow.uuid } });
  });

  it("refuses ambiguous, inactive, malformed, decreasing, locked and grant-restricted native conditions", async () => {
    const ambiguous = fixture();
    const row = { id: "one", uuid: "Actor.target.Item.one", slug: "frightened", active: true, value: 1, system: { value: { value: 1 } } };
    ambiguous.targetActor.conditions.contents.push(row, { ...row, id: "two", uuid: "Actor.target.Item.two" });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", ambiguous.selection(), ambiguous.ctx)).rejects.toMatchObject({ code: "CONDITION_STATE_AMBIGUOUS" });
    const inactive = fixture();
    inactive.targetActor.conditions.contents.push({ ...row, active: false });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", inactive.selection(), inactive.ctx)).rejects.toMatchObject({ code: "CONDITION_STATE_INACTIVE" });
    const malformed = fixture();
    malformed.targetActor.conditions.contents.push({ ...row, value: Number.NaN, system: { value: { value: Number.NaN } } });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", malformed.selection(), malformed.ctx)).rejects.toMatchObject({ code: "CONDITION_STATE_UNAVAILABLE" });
    const decrease = fixture();
    decrease.targetActor.conditions.contents.push({ ...row, value: 4, system: { value: { value: 4 } } });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", decrease.selection(), decrease.ctx)).rejects.toMatchObject({ code: "CONDITION_DECREASE_REFUSED" });
    const locked = fixture();
    locked.targetActor.conditions.contents.push({ ...row, isLocked: true });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", locked.selection(), locked.ctx)).rejects.toMatchObject({ code: "CONDITION_RESTRICTED" });
    const granted = fixture();
    granted.targetActor.conditions.contents.push({ ...row, flags: { pf2e: { grantedBy: { id: "parent" } } } });
    granted.targetActor.items.set("parent", { id: "parent", flags: { pf2e: { itemGrants: { grant: { id: "one", onDelete: "restrict" } } } } });
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", granted.selection(), granted.ctx)).rejects.toMatchObject({ code: "CONDITION_RESTRICTED" });
    const capped = fixture();
    capped.targetActor.attributes = { frightened: { max: 3 } };
    await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", capped.selection({ kind: "condition", slug: "frightened", value: 4 }), capped.ctx)).rejects.toMatchObject({ code: "INVALID_CONDITION_VALUE" });
  });

  it("reports exact already-satisfied native unvalued conditions and their restrictions without mutation", async () => {
    const f = fixture();
    const row = { id: "blinded", uuid: "Actor.target.Item.blinded", slug: "blinded", active: true, isLocked: true, name: "Blinded", system: { value: { value: null } }, flags: { pf2e: { grantedBy: { id: "parent" } } }, toObject: () => ({ _id: "blinded", type: "condition", system: { value: { value: null } }, flags: { pf2e: { grantedBy: { id: "parent" } } } }) };
    f.targetActor.conditions.contents.push(row);
    f.targetActor.items.set("parent", { id: "parent", flags: { pf2e: { itemGrants: { grant: { id: row.id, onDelete: "restrict" } } } } });
    const result: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection({ kind: "condition", slug: "blinded", value: null }), f.ctx);
    expect(result.choice).toMatchObject({
      expectedOperation: "already-satisfied", mutationAllowed: false,
      current: { uuid: row.uuid, value: null, locked: true, readOnly: false, restricted: true },
    });
    expect(f.targetActor.increaseCondition).not.toHaveBeenCalled();
    expect(f.ctx.assertWrite).not.toHaveBeenCalled();
  });

  it("detects source, condition template, and native import changes during hashing", async () => {
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const changed = fixture();
    const actorSource = changed.targetActor.toObject;
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args: any[]) => {
      changed.targetActor.toObject = () => ({ _id: "target", system: { changed: true } });
      return originalDigest(args[0], args[1]);
    });
    try {
      await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", changed.selection(), changed.ctx)).rejects.toMatchObject({ code: "SPELL_EFFECT_SOURCE_CHANGED" });
    } finally { spy.mockRestore(); changed.targetActor.toObject = actorSource; }
    const changedTemplate = fixture();
    const originalGet = changedTemplate.manager.getCondition;
    const conditionSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args: any[]) => {
      changedTemplate.manager.getCondition.mockImplementation((slug: string) => ({
        documentName: "Item", type: "condition", slug, name: "Changed",
        toObject: () => ({ _id: slug, type: "condition", system: { value: { isValued: true, value: 1 }, changed: true } }),
      }));
      return originalDigest(args[0], args[1]);
    });
    try {
      await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", changedTemplate.selection(), changedTemplate.ctx)).rejects.toMatchObject({ code: "SPELL_EFFECT_SOURCE_CHANGED" });
    } finally { conditionSpy.mockRestore(); changedTemplate.manager.getCondition.mockImplementation(originalGet); }
    const replacedCondition = fixture();
    const oldCondition: any = { id: "frightened", uuid: "Actor.target.Item.frightened", slug: "frightened", active: true, value: 1, system: { value: { value: 1 } }, flags: { pf2e: { fromSpell: false } }, toObject: () => ({ _id: "frightened", type: "condition", system: { value: { value: 1 } }, flags: { pf2e: { fromSpell: false } } }) };
    replacedCondition.targetActor.conditions.contents.push(oldCondition);
    const replaceSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args: any[]) => {
      replacedCondition.targetActor.conditions.contents[0] = { ...oldCondition, toObject: oldCondition.toObject };
      return originalDigest(args[0], args[1]);
    });
    try {
      await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", replacedCondition.selection(), replacedCondition.ctx)).rejects.toMatchObject({ code: "SPELL_EFFECT_SOURCE_CHANGED" });
    } finally { replaceSpy.mockRestore(); }
    const changedImport = fixture();
    const importSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args: any[]) => {
      changedImport.setImport({ type: "effect", system: { duration: { value: 2, unit: "hours" } } });
      return originalDigest(args[0], args[1]);
    });
    try {
      await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", changedImport.selection({ kind: "effect", uuid: "Compendium.pf2e.spell-effects.Item.bless" }), changedImport.ctx)).rejects.toMatchObject({ code: "SPELL_EFFECT_SOURCE_CHANGED" });
    } finally { importSpy.mockRestore(); }
    const replacedPackDocument = fixture();
    const packSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args: any[]) => {
      replacedPackDocument.pack.get = () => ({ ...replacedPackDocument.effectSource });
      return originalDigest(args[0], args[1]);
    });
    try {
      await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", replacedPackDocument.selection({ kind: "effect", uuid: replacedPackDocument.effectSource.uuid }), replacedPackDocument.ctx)).rejects.toMatchObject({ code: "SPELL_EFFECT_SOURCE_CHANGED" });
    } finally { packSpy.mockRestore(); }
    const changedSession = fixture();
    const sessionSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args: any[]) => {
      changedSession.ctx.sessionId = "session-other";
      return originalDigest(args[0], args[1]);
    });
    try {
      await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", changedSession.selection(), changedSession.ctx)).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    } finally { sessionSpy.mockRestore(); }
    const changedTurn = fixture();
    const combat = changedTurn.setCombat();
    const turnSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (...args: any[]) => {
      combat.round = 2;
      return originalDigest(args[0], args[1]);
    });
    try {
      await expect(handlePF2eSpellEffect("pf2e_inspect_spell_effect", changedTurn.selection(), changedTurn.ctx)).rejects.toMatchObject({ code: "STALE_TURN" });
    } finally { turnSpy.mockRestore(); }
  });

  it("reads bounded native durations with null, unlimited, expired, sustained and provenance facts without writes", async () => {
    const f = fixture();
    f.targetActor.itemTypes.effect = Array.from({ length: 55 }, (_, index) => ({
      id: `effect-${index}`, uuid: `Actor.target.Item.effect-${index}`, slug: `e-${index}`, name: `Effect ${index}`,
      isExpired: index === 0, remainingDuration: index === 1 ? {} : { remaining: index },
      system: { duration: index === 1 ? { unit: "unlimited", value: -1, expiry: null, sustained: true } : index === 2 ? {} : { value: 1, unit: "rounds", expiry: "turn-end", sustained: false }, start: index === 2 ? {} : { value: 100 + index, initiative: index } },
      origin: { uuid: "Actor.caster.Item.spell" },
      _stats: index === 1 ? { compendiumSource: "Compendium.pf2e.spell-effects.Item.bless" } : {},
      flags: { "foundry-vtt-mcp": { spellEffectApplication: { applicationId: `application-${index}`, castMessageUuid: "ChatMessage.cast-1" } } },
    }));
    f.targetActor.conditions.contents.push({ id: "frightened", uuid: "Actor.target.Item.frightened", slug: "frightened", name: "Frightened", active: true, origin: { uuid: null }, system: { duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, start: {} } });
    const first: any = await handlePF2eSpellEffect("pf2e_inspect_spell_durations", { targetUuid: f.targetActor.uuid, limit: 50 }, f.ctx);
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(55);
    expect(first.truncated).toBe(true);
    expect(first.items[0]).toMatchObject({ active: null, isExpired: false, remaining: null, duration: { unit: "unlimited", value: -1, sustained: true }, start: 101, startInitiative: 1, originUuid: "Actor.caster.Item.spell" });
    expect(first.items[0].sourceUuid).toBe("Compendium.pf2e.spell-effects.Item.bless");
    const all: any = await handlePF2eSpellEffect("pf2e_inspect_spell_durations", { targetUuid: f.targetActor.uuid, offset: 55, limit: 1, includeExpired: true }, f.ctx);
    expect(all.items[0]).toMatchObject({ kind: "condition", duration: { unit: "unlimited", value: -1, sustained: false }, isExpired: null, start: null });
    const expired: any = await handlePF2eSpellEffect("pf2e_inspect_spell_durations", { targetUuid: f.targetActor.uuid, includeExpired: true }, f.ctx);
    expect(expired.items.some((row: any) => row.uuid.endsWith("effect-0"))).toBe(true);
    const sustained: any = await handlePF2eSpellEffect("pf2e_inspect_spell_durations", { targetUuid: f.targetActor.uuid, sustainedOnly: true }, f.ctx);
    expect(sustained.items.every((row: any) => row.duration.sustained === true)).toBe(true);
    expect(f.ctx.assertWrite).not.toHaveBeenCalled();
  });

  it("links native conditions to bounded audit evidence and warns when the effect ledger is malformed", async () => {
    const f = fixture();
    f.targetActor.increaseCondition.mockImplementation(async (_slug: string, options: any) => {
      const value = options.value ?? null;
      const row: any = { id: "frightened", uuid: "Actor.target.Item.frightened", documentName: "Item", type: "condition", slug: "frightened",
        name: "Frightened", active: true, value, system: { value: { value }, duration: { unit: "unlimited", value: -1, sustained: false } },
        parent: f.targetActor, toObject() { return { _id: this.id, type: this.type, slug: this.slug, system: structuredClone(this.system) }; } };
      f.targetActor.conditions.contents.push(row);
      f.targetActor.items.set(row.id, row);
      return row;
    });
    const preview: any = await handlePF2eSpellEffect("pf2e_inspect_spell_effect", f.selection(), f.ctx);
    await handlePF2eSpellEffect("pf2e_apply_spell_effect", {
      ...preview.selection, applicationId: preview.applicationId, reviewToken: preview.reviewToken, expectedCombat: preview.expectedCombat,
    }, f.ctx);
    const linked: any = await handlePF2eSpellEffect("pf2e_inspect_spell_durations", { targetUuid: f.targetActor.uuid, limit: 10 }, f.ctx);
    expect(linked.items[0]).toMatchObject({ kind: "condition", auditLink: { applicationId: preview.applicationId, castMessageUuid: f.castRecord.chatMessageUuid } });
    expect(linked.auditLinksAvailable).toBe(true);
    f.setLedger({ version: 1, entries: { malformed: { bad: true } } });
    const warning: any = await handlePF2eSpellEffect("pf2e_inspect_spell_durations", { targetUuid: f.targetActor.uuid, limit: 10 }, f.ctx);
    expect(warning.items).toHaveLength(1);
    expect(warning.items[0].auditLink).toBeNull();
    expect(warning.auditLinksAvailable).toBe(false);
    expect(warning.warnings.join(" ")).toMatch(/malformed/);
  });
});
