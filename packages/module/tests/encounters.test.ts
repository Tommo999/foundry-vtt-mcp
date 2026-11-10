import { describe, expect, it, vi } from "vitest";
import { handleEncounters, withCombatLock } from "../src/encounters.js";
import type { BridgeContext } from "../src/bridge-context.js";

function makeCollection(entries: any[] = []) {
  const collection: any = {
    contents: entries,
    get(id: string) {
      return this.contents.find((entry: any) => entry.id === id) ?? null;
    },
    values() {
      return this.contents.values();
    },
    add(entry: any) {
      this.contents.push(entry);
      return entry;
    },
  };
  return collection;
}
function makeEnv() {
  const scenes = makeCollection();
  const combats = makeCollection();
  const resolved = new Map<string, any>();
  const scene: any = {
    id: "scene1",
    uuid: "Scene.scene1",
    documentName: "Scene",
    name: "Vault",
    parent: null,
    compendium: null,
    tokens: makeCollection(),
  };
  scenes.add(scene);
  resolved.set(scene.uuid, scene);
  const combatants = makeCollection();
  const combat: any = {
    id: "combat1",
    uuid: "Combat.combat1",
    documentName: "Combat",
    parent: null,
    compendium: null,
    scene,
    sceneId: scene.id,
    active: false,
    started: false,
    round: 0,
    turn: null,
    combatants,
    createEmbeddedDocuments: vi.fn(
      async (name: string, rows: any[], options: any) => {
        expect(name).toBe("Combatant");
        expect(options).toMatchObject({ keepId: false });
        return rows.map((row, index) => {
          const token = scene.tokens.get(row.tokenId);
          const entry: any = {
            ...row,
            id: "combatant-" + (combatants.contents.length + 1),
            uuid:
              "Combat.combat1.Combatant." + (combatants.contents.length + 1),
            documentName: "Combatant",
            parent: combat,
            combat,
            token,
            actor: token?.actor,
            initiative: undefined,
          };
          combatants.add(entry);
          return entry;
        });
      },
    ),
    deleteEmbeddedDocuments: vi.fn(async (_name: string, ids: string[]) => {
      const deleted = combatants.contents.filter((entry: any) =>
        ids.includes(entry.id),
      );
      combatants.contents = combatants.contents.filter(
        (entry: any) => !ids.includes(entry.id),
      );
      return deleted;
    }),
  };
  combats.add(combat);
  resolved.set(combat.uuid, combat);
  const actor1 = {
    id: "actor1",
    uuid: "Actor.actor1",
    documentName: "Actor",
    type: "npc",
    name: "Guard",
  };
  const actor2 = {
    id: "actor2",
    uuid: "Actor.actor2",
    documentName: "Actor",
    type: "npc",
    name: "Archer",
  };
  const token1: any = {
    id: "token1",
    uuid: "Scene.scene1.Token.token1",
    documentName: "Token",
    parent: scene,
    actor: actor1,
    actorId: actor1.id,
    hidden: false,
    flags: {},
  };
  const token2: any = {
    id: "token2",
    uuid: "Scene.scene1.Token.token2",
    documentName: "Token",
    parent: scene,
    actor: actor2,
    actorId: actor2.id,
    hidden: true,
    flags: {},
  };
  scene.tokens.add(token1);
  scene.tokens.add(token2);
  resolved.set(token1.uuid, token1);
  resolved.set(token2.uuid, token2);
  const writes = vi.fn();
  const ctx: BridgeContext = {
    game: {
      scenes,
      system: { id: "pf2e" },
      pf2e: {},
      settings: { get: () => true },
      combat: null,
      user: { id: "gm" },
      combats: Object.assign(combats, {
        documentClass: {
          create: vi.fn(async (data: any, options: any) => {
            expect(data).toMatchObject({
              scene: scene.id,
              active: false,
              round: 0,
              turn: null,
            });
            expect(data.name).toBeUndefined();
            expect(options).toMatchObject({
              keepId: false,
              render: false,
              renderSheet: false,
            });
            const created: any = {
              ...data,
              id: "created-combat",
              uuid: "Combat.created-combat",
              documentName: "Combat",
              parent: null,
              scene,
              sceneId: scene.id,
              combatants: makeCollection(),
              active: false,
              started: false,
            };
            combats.add(created);
            return created;
          }),
        },
      }),
    },
    resolve: async (uuid) =>
      resolved.get(uuid) ??
      [
        ...combats.contents.flatMap((entry: any) => entry.combatants.contents),
        ...scenes.contents.flatMap((entry: any) => entry.tokens.contents),
      ].find((entry: any) => entry.uuid === uuid),
    assertWrite: writes,
    serialize: (document) => ({ uuid: document.uuid }),
  };
  return {
    ctx,
    scene,
    combat,
    token1,
    token2,
    actor1,
    actor2,
    resolved,
    writes,
    scenes,
    combats,
  };
}

function makeCurrentStartedCombat(env: ReturnType<typeof makeEnv>) {
  const combatant = {
    id: "active-combatant",
    uuid: "Combat.combat1.Combatant.active-combatant",
    documentName: "Combatant",
    parent: env.combat,
    combat: env.combat,
  };
  env.combat.started = true;
  env.combat.active = false;
  env.combat.round = 1;
  env.combat.turn = 0;
  env.combat.combatant = combatant;
  env.ctx.game.combat = env.combat;
  return combatant;
}

function endArgs(env: ReturnType<typeof makeEnv>, combatant: any) {
  return {
    encounterUuid: env.combat.uuid,
    expectedRound: env.combat.round,
    expectedTurn: env.combat.turn,
    expectedCombatantUuid: combatant?.uuid ?? null,
  };
}

describe("system-agnostic encounters adapter", () => {
  it("lists world encounters and filters by a validated scene", async () => {
    const env = makeEnv();
    const result: any = await handleEncounters(
      "list_encounters",
      { sceneUuid: env.scene.uuid, offset: 0, limit: 5 },
      env.ctx,
    );
    expect(result.total).toBe(1);
    expect(result.encounters[0]).toMatchObject({
      uuid: env.combat.uuid,
      sceneUuid: env.scene.uuid,
      started: false,
      round: 0,
      turn: null,
    });
  });

  it("reports selected current combat as active even when its legacy flag is false", async () => {
    const env = makeEnv();
    env.combat.active = false;
    env.ctx.game.combat = env.combat;
    const entry: any = {
      id: "current",
      uuid: "Combat.combat1.Combatant.current",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      actor: env.actor1,
      initiative: 18,
    };
    env.combat.combatants.add(entry);
    env.combat.activate = vi.fn();
    env.combat.startCombat = vi.fn(async () => {
      env.combat.started = true;
      env.combat.round = 1;
      env.combat.turn = 0;
      env.combat.combatant = entry;
      return env.combat;
    });
    const listedBefore: any = await handleEncounters(
      "list_encounters",
      { offset: 0, limit: 10 },
      env.ctx,
    );
    const inspectedBefore: any = await handleEncounters(
      "inspect_encounter",
      { uuid: env.combat.uuid, offset: 0, limit: 10 },
      env.ctx,
    );
    expect(listedBefore.encounters[0].active).toBe(true);
    expect(inspectedBefore.active).toBe(true);

    const started: any = await handleEncounters(
      "start_encounter",
      { encounterUuid: env.combat.uuid },
      env.ctx,
    );
    expect(started).toMatchObject({ active: true, started: true });
    expect(env.combat.activate).not.toHaveBeenCalled();

    env.combat.nextTurn = vi.fn(async () => {
      env.combat.turn = 1;
      return env.combat;
    });
    const advanced: any = await handleEncounters(
      "next_turn",
      {
        encounterUuid: env.combat.uuid,
        expectedRound: 1,
        expectedTurn: 0,
        expectedCombatantUuid: entry.uuid,
      },
      env.ctx,
    );
    expect(advanced).toMatchObject({
      active: true,
      started: true,
      round: 1,
      turn: 1,
    });
    expect(env.combat.active).toBe(false);
  });

  it("ends only the current started root combat through its native delete method", async () => {
    const env = makeEnv();
    const combatant = makeCurrentStartedCombat(env);
    env.combat.delete = vi.fn(async () => {
      env.combats.contents = env.combats.contents.filter(
        (entry: any) => entry !== env.combat,
      );
      return [env.combat];
    });
    const ended = await handleEncounters(
      "end_encounter",
      endArgs(env, combatant),
      env.ctx,
    );
    expect(ended).toMatchObject({
      encounterUuid: env.combat.uuid,
      ended: true,
      removed: true,
      round: 1,
      turn: 0,
      combatantUuid: combatant.uuid,
    });
    expect(env.combat.delete).toHaveBeenCalledOnce();
    expect(env.scene.tokens.contents).toHaveLength(2);
    expect(env.actor1.uuid).toBe("Actor.actor1");
  });

  it("ends an active started empty combat with the inspected null tracker values", async () => {
    const env = makeEnv();
    env.combat.started = true;
    env.combat.active = false;
    env.combat.round = 1;
    env.combat.turn = null;
    env.combat.combatant = null;
    env.ctx.game.combat = env.combat;
    env.combat.delete = vi.fn(async () => {
      env.combats.contents = [];
    });
    await expect(
      handleEncounters(
        "end_encounter",
        {
          encounterUuid: env.combat.uuid,
          expectedRound: 1,
          expectedTurn: null,
          expectedCombatantUuid: null,
        },
        env.ctx,
      ),
    ).resolves.toMatchObject({ ended: true, removed: true });
    expect(env.combat.delete).toHaveBeenCalledOnce();
  });

  it.each([
    ["unstarted", false, true],
    ["inactive", true, false],
  ])("does not end an %s encounter", async (_label, started, active) => {
    const env = makeEnv();
    const combatant = makeCurrentStartedCombat(env);
    env.combat.started = started;
    if (!active) env.ctx.game.combat = null;
    env.combat.delete = vi.fn();
    await expect(
      handleEncounters("end_encounter", endArgs(env, combatant), env.ctx),
    ).rejects.toMatchObject({ code: "ENCOUNTER_NOT_ACTIVE" });
    expect(env.combat.delete).not.toHaveBeenCalled();
  });

  it("rejects stale tracker state and concurrent duplicate end requests without repeating deletion", async () => {
    const env = makeEnv();
    const combatant = makeCurrentStartedCombat(env);
    env.combat.delete = vi.fn(async () => {
      env.combats.contents = [];
    });
    const stale = { ...endArgs(env, combatant), expectedRound: 2 };
    await expect(
      handleEncounters("end_encounter", stale, env.ctx),
    ).rejects.toMatchObject({ code: "STALE_TURN" });
    const first = handleEncounters(
      "end_encounter",
      endArgs(env, combatant),
      env.ctx,
    );
    const second = handleEncounters(
      "end_encounter",
      endArgs(env, combatant),
      env.ctx,
    );
    await expect(first).resolves.toMatchObject({ ended: true });
    await expect(second).rejects.toMatchObject({ code: "INVALID_ENCOUNTER" });
    expect(env.combat.delete).toHaveBeenCalledOnce();
  });

  it("rejects a wrong or non-world encounter target", async () => {
    const env = makeEnv();
    const combatant = makeCurrentStartedCombat(env);
    env.combat.delete = vi.fn();
    await expect(
      handleEncounters(
        "end_encounter",
        { ...endArgs(env, combatant), encounterUuid: "Combat.other" },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_ENCOUNTER" });
    expect(env.combat.delete).not.toHaveBeenCalled();
  });

  it("rechecks authorization after waiting for the combat lock", async () => {
    const env = makeEnv();
    const combatant = makeCurrentStartedCombat(env);
    env.combat.delete = vi.fn();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = withCombatLock(env.combat, env.ctx, async () => barrier);
    await Promise.resolve();
    const ending = handleEncounters(
      "end_encounter",
      endArgs(env, combatant),
      env.ctx,
    );
    env.writes
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("GM authorization changed."), {
          code: "SESSION_CHANGED",
        });
      });
    release();
    await blocker;
    await expect(ending).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(env.combat.delete).not.toHaveBeenCalled();
  });

  it("reports native deletion errors and unconfirmed removal as uncertain partial outcomes", async () => {
    for (const deleteCombat of [
      vi.fn(async () => {
        throw new Error("native delete failed");
      }),
      vi.fn(async () => []),
    ]) {
      const env = makeEnv();
      const combatant = makeCurrentStartedCombat(env);
      env.combat.delete = deleteCombat;
      await expect(
        handleEncounters("end_encounter", endArgs(env, combatant), env.ctx),
      ).rejects.toMatchObject({
        code: "PARTIAL_FAILURE",
        partial: {
          encounterUuid: env.combat.uuid,
          outcomeUnknown: true,
        },
      });
      expect(deleteCombat).toHaveBeenCalledOnce();
    }
  });

  it("reports a native hook error coded STALE_TURN as a partial outcome after removal", async () => {
    const env = makeEnv();
    const combatant = makeCurrentStartedCombat(env);
    env.combat.delete = vi.fn(async () => {
      env.combats.contents = [];
      throw Object.assign(new Error("post-delete hook failed"), {
        code: "STALE_TURN",
      });
    });
    await expect(
      handleEncounters("end_encounter", endArgs(env, combatant), env.ctx),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: { removed: true, outcomeUnknown: true },
    });
    expect(env.combat.delete).toHaveBeenCalledOnce();
  });

  it("treats a replacement document with the same id or uuid as unconfirmed removal", async () => {
    const env = makeEnv();
    const combatant = makeCurrentStartedCombat(env);
    env.combat.delete = vi.fn(async () => {
      env.combats.contents = [
        {
          ...env.combat,
          documentName: "Combat",
          parent: null,
          compendium: null,
        },
      ];
    });
    await expect(
      handleEncounters("end_encounter", endArgs(env, combatant), env.ctx),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: { removed: false, outcomeUnknown: true },
    });
    expect(env.combat.delete).toHaveBeenCalledOnce();
  });

  it("does not report unselected preparation or started combats as active", async () => {
    const env = makeEnv();
    const started: any = {
      id: "started-unselected",
      uuid: "Combat.started-unselected",
      documentName: "Combat",
      parent: null,
      compendium: null,
      scene: env.scene,
      sceneId: env.scene.id,
      active: false,
      started: true,
      round: 1,
      turn: 0,
      combatants: makeCollection(),
    };
    env.combats.add(started);
    env.resolved.set(started.uuid, started);
    const listed: any = await handleEncounters(
      "list_encounters",
      { offset: 0, limit: 10 },
      env.ctx,
    );
    expect(listed.encounters).toHaveLength(2);
    expect(listed.encounters.map((entry: any) => entry.active)).toEqual([
      false,
      false,
    ]);
    expect(listed.encounters[1].started).toBe(true);
    const inspected: any = await handleEncounters(
      "inspect_encounter",
      { uuid: started.uuid, offset: 0, limit: 10 },
      env.ctx,
    );
    expect(inspected).toMatchObject({ active: false, started: true });
  });

  it("creates a native inactive combat associated with the chosen scene", async () => {
    const env = makeEnv();
    const result: any = await handleEncounters(
      "create_encounter",
      { sceneUuid: env.scene.uuid },
      env.ctx,
    );
    expect(result).toMatchObject({
      uuid: "Combat.created-combat",
      sceneUuid: env.scene.uuid,
      active: false,
      started: false,
      round: 0,
    });
    expect(env.ctx.game.combats.documentClass.create).toHaveBeenCalledTimes(1);
  });

  it("reports unexpected active state as an uncertain native create", async () => {
    const env = makeEnv();
    env.ctx.game.combats.documentClass.create = vi.fn(async () => {
      const unexpected: any = {
        id: "unexpected",
        uuid: "Combat.unexpected",
        documentName: "Combat",
        parent: null,
        scene: env.scene,
        sceneId: env.scene.id,
        active: true,
        started: true,
        round: 1,
        turn: 0,
        combatants: makeCollection(),
      };
      env.combats.add(unexpected);
      return unexpected;
    });
    await expect(
      handleEncounters(
        "create_encounter",
        { sceneUuid: env.scene.uuid },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        returnedEncounterUuid: "Combat.unexpected",
        outcomeUnknown: true,
      },
    });
  });

  it("inspects combatants without inventing initiative and reads started combats", async () => {
    const env = makeEnv();
    env.combat.started = true;
    env.combat.round = 2;
    const entry: any = {
      id: "c1",
      uuid: "Combat.combat1.Combatant.c1",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      token: env.token1,
      actor: env.actor1,
      tokenId: env.token1.id,
      initiative: undefined,
      hidden: false,
    };
    env.combat.combatants.add(entry);
    const inspected: any = await handleEncounters(
      "inspect_encounter",
      { uuid: env.combat.uuid, offset: 0, limit: 10 },
      env.ctx,
    );
    expect(inspected.combatants[0]).toMatchObject({
      uuid: entry.uuid,
      name: "Guard",
      initiative: null,
      actorUuid: env.actor1.uuid,
      tokenUuid: env.token1.uuid,
    });
    expect(inspected.round).toBe(2);
    await expect(
      handleEncounters(
        "add_combatants",
        { encounterUuid: env.combat.uuid, tokenUuids: [env.token2.uuid] },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "ENCOUNTER_STARTED" });
  });

  it("adds only selected same-scene tokens with native minimal combatant data", async () => {
    const env = makeEnv();
    const result: any = await handleEncounters(
      "add_combatants",
      {
        encounterUuid: env.combat.uuid,
        tokenUuids: [env.token1.uuid, env.token2.uuid],
      },
      env.ctx,
    );
    expect(result.addedCombatantUuids).toHaveLength(2);
    expect(env.combat.createEmbeddedDocuments).toHaveBeenCalledWith(
      "Combatant",
      [
        {
          sceneId: env.scene.id,
          tokenId: env.token1.id,
          actorId: env.actor1.id,
          hidden: false,
        },
        {
          sceneId: env.scene.id,
          tokenId: env.token2.id,
          actorId: env.actor2.id,
          hidden: true,
        },
      ],
      { keepId: false },
    );
    expect(env.token1).toHaveProperty("parent", env.scene);
  });

  it("skips duplicates already in the encounter but allows tokens in other encounters", async () => {
    const env = makeEnv();
    const duplicate: any = {
      id: "old",
      uuid: "Combat.combat1.Combatant.old",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      token: env.token1,
      tokenId: env.token1.id,
      actor: env.actor1,
    };
    env.combat.combatants.add(duplicate);
    const other = { ...env.token2 };
    const result: any = await handleEncounters(
      "add_combatants",
      {
        encounterUuid: env.combat.uuid,
        tokenUuids: [env.token1.uuid, env.token2.uuid],
      },
      env.ctx,
    );
    expect(result.skippedTokenUuids).toEqual([env.token1.uuid]);
    expect(result.addedCombatantUuids).toHaveLength(1);
    expect(other.uuid).toBe(env.token2.uuid);
  });

  it("rejects foreign-scene, actorless, party, and troop tokens before any write", async () => {
    const env = makeEnv();
    const foreignScene: any = {
      id: "foreign",
      uuid: "Scene.foreign",
      documentName: "Scene",
      parent: null,
      tokens: makeCollection(),
    };
    const foreign: any = {
      id: "f",
      uuid: "Scene.foreign.Token.f",
      documentName: "Token",
      parent: foreignScene,
      actor: env.actor1,
    };
    env.resolved.set(foreign.uuid, foreign);
    await expect(
      handleEncounters(
        "add_combatants",
        {
          encounterUuid: env.combat.uuid,
          tokenUuids: [env.token1.uuid, foreign.uuid],
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    const party = { ...env.actor1, type: "party" };
    const partyToken = {
      ...env.token2,
      id: "party",
      actor: party,
      uuid: "Scene.scene1.Token.party",
    };
    env.scene.tokens.add(partyToken);
    env.resolved.set(partyToken.uuid, partyToken);
    await expect(
      handleEncounters(
        "add_combatants",
        { encounterUuid: env.combat.uuid, tokenUuids: [partyToken.uuid] },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_COMBATANT" });
    expect(env.combat.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("serializes concurrent additions and rechecks membership inside the lock", async () => {
    const env = makeEnv();
    const [one, two] = await Promise.all([
      handleEncounters(
        "add_combatants",
        { encounterUuid: env.combat.uuid, tokenUuids: [env.token1.uuid] },
        env.ctx,
      ),
      handleEncounters(
        "add_combatants",
        { encounterUuid: env.combat.uuid, tokenUuids: [env.token1.uuid] },
        env.ctx,
      ),
    ]);
    expect(env.combat.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(
      (one as any).addedCombatantUuids.length +
        (two as any).addedCombatantUuids.length,
    ).toBe(1);
  });

  it("removes only exact combatant children and never deletes tokens", async () => {
    const env = makeEnv();
    await handleEncounters(
      "add_combatants",
      { encounterUuid: env.combat.uuid, tokenUuids: [env.token1.uuid] },
      env.ctx,
    );
    const combatant = env.combat.combatants.contents[0];
    const result: any = await handleEncounters(
      "remove_combatants",
      { encounterUuid: env.combat.uuid, combatantUuids: [combatant.uuid] },
      env.ctx,
    );
    expect(result.removedCombatantUuids).toEqual([combatant.uuid]);
    expect(env.combat.deleteEmbeddedDocuments).toHaveBeenCalledWith(
      "Combatant",
      [combatant.id],
    );
    expect(env.scene.tokens.get(env.token1.id)).toBe(env.token1);
  });

  it("rejects a combatant from another combat before deleting anything", async () => {
    const env = makeEnv();
    const other: any = {
      ...env.combat,
      id: "other",
      uuid: "Combat.other",
      combatants: makeCollection(),
    };
    const foreign: any = {
      id: "foreign",
      uuid: "Combat.other.Combatant.foreign",
      documentName: "Combatant",
      parent: other,
      combat: other,
    };
    env.resolved.set(foreign.uuid, foreign);
    await expect(
      handleEncounters(
        "remove_combatants",
        { encounterUuid: env.combat.uuid, combatantUuids: [foreign.uuid] },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_COMBATANT" });
    expect(env.combat.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("reports known combatants and uncertain outcome after native partial failure", async () => {
    const env = makeEnv();
    env.combat.createEmbeddedDocuments = vi.fn(
      async (_name: string, rows: any[]) => {
        const token = env.scene.tokens.get(rows[0].tokenId);
        const entry: any = {
          id: "partial",
          uuid: "Combat.combat1.Combatant.partial",
          documentName: "Combatant",
          parent: env.combat,
          combat: env.combat,
          token,
          actor: token.actor,
          tokenId: token.id,
        };
        env.combat.combatants.add(entry);
        throw new Error("connection dropped after native write");
      },
    );
    await expect(
      handleEncounters(
        "add_combatants",
        {
          encounterUuid: env.combat.uuid,
          tokenUuids: [env.token1.uuid, env.token2.uuid],
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        createdCombatantUuids: ["Combat.combat1.Combatant.partial"],
        outcomeUnknown: true,
      },
    });
  });

  it("uses the combat snapshot when native creation returns an empty result", async () => {
    const env = makeEnv();
    env.combat.createEmbeddedDocuments = vi.fn(
      async (_name: string, rows: any[]) => {
        const entry: any = {
          ...rows[0],
          id: "persisted-without-response",
          uuid: "Combat.combat1.Combatant.persisted",
          documentName: "Combatant",
          parent: env.combat,
          combat: env.combat,
          token: env.token1,
          actor: env.actor1,
        };
        env.combat.combatants.add(entry);
        return [];
      },
    );
    await expect(
      handleEncounters(
        "add_combatants",
        {
          encounterUuid: env.combat.uuid,
          tokenUuids: [env.token1.uuid],
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        createdCombatantUuids: ["Combat.combat1.Combatant.persisted"],
        outcomeUnknown: true,
      },
    });
  });

  it("starts only an active encounter with combatants and confirmed initiative", async () => {
    const env = makeEnv();
    const entry: any = {
      id: "c1",
      uuid: "Combat.combat1.Combatant.c1",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      actor: env.actor1,
      initiative: 18,
    };
    env.combat.combatants.add(entry);
    env.combat.activate = vi.fn(async () => {
      env.combat.active = true;
      env.ctx.game.combat = env.combat;
      return env.combat;
    });
    env.combat.startCombat = vi.fn(async () => {
      env.combat.started = true;
      env.combat.round = 1;
      env.combat.turn = 0;
      env.combat.combatant = entry;
      return env.combat;
    });
    const result: any = await handleEncounters(
      "start_encounter",
      { encounterUuid: env.combat.uuid },
      env.ctx,
    );
    expect(result).toMatchObject({ started: true, round: 1, turn: 0 });
    expect(env.combat.activate).toHaveBeenCalledOnce();
    expect(env.combat.startCombat).toHaveBeenCalledOnce();
    expect(env.combat).toMatchObject({ round: 1, turn: 0 });
  });

  it("rejects start when another started encounter is active or initiative is missing", async () => {
    const env = makeEnv();
    const entry: any = {
      id: "c1",
      uuid: "Combat.combat1.Combatant.c1",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      initiative: null,
    };
    env.combat.combatants.add(entry);
    env.combat.activate = vi.fn();
    await expect(
      handleEncounters(
        "start_encounter",
        { encounterUuid: env.combat.uuid },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "INITIATIVE_REQUIRED" });
    expect(env.combat.activate).not.toHaveBeenCalled();
    entry.initiative = 10;
    const active: any = {
      id: "other",
      uuid: "Combat.other",
      documentName: "Combat",
      parent: null,
      active: true,
      started: true,
    };
    env.combats.add(active);
    env.combat.activate = vi.fn();
    await expect(
      handleEncounters(
        "start_encounter",
        { encounterUuid: env.combat.uuid },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "OTHER_ENCOUNTER_ACTIVE" });
    expect(env.combat.activate).not.toHaveBeenCalled();
  });

  it("advances one expected turn through the native method and rejects stale concurrent requests", async () => {
    const env = makeEnv();
    const first: any = {
      id: "c1",
      uuid: "Combat.combat1.Combatant.c1",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
    };
    const second: any = {
      id: "c2",
      uuid: "Combat.combat1.Combatant.c2",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
    };
    env.combat.combatants.add(first);
    env.combat.combatants.add(second);
    env.combat.started = true;
    env.combat.active = true;
    env.combat.round = 1;
    env.combat.turn = 0;
    env.combat.combatant = first;
    env.ctx.game.combat = env.combat;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    env.combat.nextTurn = vi.fn(async () => {
      await barrier;
      env.combat.turn = 1;
      env.combat.combatant = second;
      return env.combat;
    });
    const args = {
      encounterUuid: env.combat.uuid,
      expectedRound: 1,
      expectedTurn: 0,
      expectedCombatantUuid: first.uuid,
    };
    const firstCall = handleEncounters("next_turn", args, env.ctx);
    await Promise.resolve();
    await Promise.resolve();
    const secondCall = handleEncounters("next_turn", args, env.ctx);
    release();
    await expect(firstCall).resolves.toMatchObject({ round: 1, turn: 1 });
    await expect(secondCall).rejects.toMatchObject({ code: "STALE_TURN" });
    expect(env.combat.nextTurn).toHaveBeenCalledOnce();
  });

  it("rolls configured PF2e initiative with native callback confirmation and skips existing rolls", async () => {
    const env = makeEnv();
    const actor = {
      ...env.actor1,
      system: { initiative: { statistic: "stealth" } },
      initiative: { statistic: { base: { slug: "stealth" } }, roll: vi.fn() },
    };
    env.token1.actor = actor;
    const entry: any = {
      id: "c1",
      uuid: "Combat.combat1.Combatant.c1",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      token: env.token1,
      tokenId: env.token1.id,
      actor,
      initiative: null,
    };
    env.combat.combatants.add(entry);
    env.combat.rollInitiative = vi.fn(async (_ids: string[], options: any) => {
      options.callback({ total: 22 }, null, { uuid: "ChatMessage.roll" }, null);
      entry.initiative = 22;
      return env.combat;
    });
    const args = {
      encounterUuid: env.combat.uuid,
      combatantUuids: [entry.uuid],
      reroll: false,
      messageMode: "gm",
    };
    const first: any = await handleEncounters(
      "pf2e_roll_initiative",
      args,
      env.ctx,
    );
    expect(first.rolled).toEqual([
      {
        combatantUuid: entry.uuid,
        initiative: 22,
        statistic: "stealth",
        messageUuid: "ChatMessage.roll",
      },
    ]);
    expect(env.combat.rollInitiative).toHaveBeenCalledWith(
      [entry.id],
      expect.objectContaining({
        skipDialog: true,
        createMessage: true,
        updateTurn: false,
        messageMode: "gm",
        callback: expect.any(Function),
      }),
    );
    const skipped: any = await handleEncounters(
      "pf2e_roll_initiative",
      args,
      env.ctx,
    );
    expect(skipped.skippedCombatantUuids).toEqual([entry.uuid]);
    expect(env.combat.rollInitiative).toHaveBeenCalledOnce();
  });

  it("reports cancellation and reroll failures with already rolled outcomes", async () => {
    const env = makeEnv();
    const actors = [env.actor1, env.actor2].map((actor, index) => ({
      ...actor,
      initiative: {
        statistic: { base: { slug: "perception" } },
        roll: vi.fn(),
      },
    }));
    const entries = actors.map((actor, index) => {
      const entry: any = {
        id: `c${index}`,
        uuid: `Combat.combat1.Combatant.c${index}`,
        documentName: "Combatant",
        parent: env.combat,
        combat: env.combat,
        actor,
        initiative: index === 0 ? 16 : null,
      };
      env.combat.combatants.add(entry);
      return entry;
    });
    env.combat.rollInitiative = vi.fn(async (ids: string[], options: any) => {
      if (ids[0] === entries[1].id) return env.combat; // Native dialog was cancelled; no callback or tracker update.
      options.callback(
        { total: 16 },
        null,
        { uuid: "ChatMessage.first" },
        null,
      );
      entries[0].initiative = 16;
      return env.combat;
    });
    await expect(
      handleEncounters(
        "pf2e_roll_initiative",
        {
          encounterUuid: env.combat.uuid,
          combatantUuids: entries.map((entry) => entry.uuid),
          reroll: true,
          messageMode: "gm",
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        rolled: [{ combatantUuid: entries[0].uuid, initiative: 16 }],
        failedCombatantUuid: entries[1].uuid,
        outcomeUnknown: true,
      },
    });
  });

  it("rejects unsupported and foreign initiative combatants and checks PF2e availability", async () => {
    const env = makeEnv();
    env.combat.rollInitiative = vi.fn();
    const missing: any = {
      id: "x",
      uuid: "Combat.combat1.Combatant.x",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      actor: env.actor1,
    };
    env.combat.combatants.add(missing);
    await expect(
      handleEncounters(
        "pf2e_roll_initiative",
        { encounterUuid: env.combat.uuid, combatantUuids: [missing.uuid] },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_COMBATANT" });
    env.resolved.set("Combat.foreign.Combatant.f", {
      ...missing,
      uuid: "Combat.foreign.Combatant.f",
    });
    await expect(
      handleEncounters(
        "pf2e_roll_initiative",
        {
          encounterUuid: env.combat.uuid,
          combatantUuids: ["Combat.foreign.Combatant.f"],
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_COMBATANT" });
    env.ctx.game.settings.get = () => false;
    await expect(
      handleEncounters(
        "pf2e_roll_initiative",
        { encounterUuid: env.combat.uuid, combatantUuids: [missing.uuid] },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_UNAVAILABLE" });
  });

  it("retains the first confirmed roll when authorization is revoked before the next roll", async () => {
    const env = makeEnv();
    const actors = [env.actor1, env.actor2].map((actor) => ({
      ...actor,
      initiative: {
        statistic: { base: { slug: "perception" } },
        roll: vi.fn(),
      },
    }));
    const entries = actors.map((actor, index) => {
      const entry: any = {
        id: `auth-${index}`,
        uuid: `Combat.combat1.Combatant.auth-${index}`,
        documentName: "Combatant",
        parent: env.combat,
        combat: env.combat,
        actor,
        initiative: null,
      };
      env.combat.combatants.add(entry);
      return entry;
    });
    let approvals = 0;
    env.ctx.assertWrite = vi.fn(() => {
      approvals++;
      if (approvals === 6)
        throw Object.assign(new Error("authorization revoked"), {
          code: "SESSION_CHANGED",
        });
    });
    env.combat.rollInitiative = vi.fn(async (_ids: string[], options: any) => {
      options.callback(
        { total: 19 },
        null,
        { uuid: "ChatMessage.confirmed" },
        null,
      );
      entries[0].initiative = 19;
      return env.combat;
    });
    await expect(
      handleEncounters(
        "pf2e_roll_initiative",
        {
          encounterUuid: env.combat.uuid,
          combatantUuids: entries.map((entry) => entry.uuid),
          reroll: false,
          messageMode: "gm",
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        rolled: [
          {
            combatantUuid: entries[0].uuid,
            initiative: 19,
            messageUuid: "ChatMessage.confirmed",
          },
        ],
        failedCombatantUuid: entries[1].uuid,
        outcomeUnknown: true,
      },
    });
    expect(env.combat.rollInitiative).toHaveBeenCalledOnce();
  });

  it("revalidates actor initiative support after waiting for the shared combat lock", async () => {
    const env = makeEnv();
    env.combat.rollInitiative = vi.fn();
    const actor: any = {
      ...env.actor1,
      initiative: {
        statistic: { base: { slug: "perception" } },
        roll: vi.fn(),
      },
    };
    const entry: any = {
      id: "waiting",
      uuid: "Combat.combat1.Combatant.waiting",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      actor,
      initiative: null,
    };
    env.combat.combatants.add(entry);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const nativeEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const nativeAdd = env.combat.createEmbeddedDocuments;
    env.combat.createEmbeddedDocuments = vi.fn(async (...args: any[]) => {
      entered();
      await barrier;
      return nativeAdd(...args);
    });
    const addPromise = handleEncounters(
      "add_combatants",
      {
        encounterUuid: env.combat.uuid,
        tokenUuids: [env.token2.uuid],
      },
      env.ctx,
    );
    await nativeEntered;
    expect(env.combat.createEmbeddedDocuments).toHaveBeenCalledOnce();
    const initiativePromise = handleEncounters(
      "pf2e_roll_initiative",
      {
        encounterUuid: env.combat.uuid,
        combatantUuids: [entry.uuid],
        reroll: false,
        messageMode: "gm",
      },
      env.ctx,
    );
    delete actor.initiative;
    release();
    await addPromise;
    await expect(initiativePromise).rejects.toMatchObject({
      code: "INVALID_COMBATANT",
    });
    expect(env.combat.rollInitiative).not.toHaveBeenCalled();
  });

  it("reports successful activation as partial when authorization changes before combat start", async () => {
    const env = makeEnv();
    env.combat.combatants.add({
      id: "ready",
      uuid: "Combat.combat1.Combatant.ready",
      documentName: "Combatant",
      parent: env.combat,
      combat: env.combat,
      initiative: 17,
    });
    env.combat.activate = vi.fn(async () => {
      env.combat.active = true;
      env.ctx.game.combat = env.combat;
      return env.combat;
    });
    env.combat.startCombat = vi.fn();
    let approvals = 0;
    env.ctx.assertWrite = vi.fn(() => {
      approvals++;
      if (approvals === 4)
        throw Object.assign(new Error("authorization revoked"), {
          code: "SESSION_CHANGED",
        });
    });
    await expect(
      handleEncounters(
        "start_encounter",
        { encounterUuid: env.combat.uuid },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        active: true,
        started: false,
        activationAttempted: true,
        outcomeUnknown: true,
      },
    });
    expect(env.combat.activate).toHaveBeenCalledOnce();
    expect(env.combat.startCombat).not.toHaveBeenCalled();
  });
});
