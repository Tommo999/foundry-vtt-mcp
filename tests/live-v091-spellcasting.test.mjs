import { describe, expect, it } from "vitest";
import {
  assertNoPendingWork,
  validCastResult,
  validateProgressBinding,
  validateWriteResult,
} from "../scripts/live-v091-spellcasting.mjs";

describe("v0.9.1 live acceptance harness guards", () => {
  it("refuses to resume fixtures in another world or module version", () => {
    const progress = {
      environment: { worldId: "world-a", expectedVersion: "0.9.0" },
    };
    expect(() => validateProgressBinding(progress, "world-b", "0.9.0")).toThrow(
      /different world or version/,
    );
    expect(() => validateProgressBinding(progress, "world-a", "0.9.1")).toThrow(
      /different world or version/,
    );
    expect(() =>
      validateProgressBinding(progress, "world-a", "0.9.0"),
    ).not.toThrow();
  });

  it("blocks automatic retries of in-flight or uncertain mutations", () => {
    expect(() =>
      assertNoPendingWork({ stages: { actor: { status: "in_flight" } } }),
    ).toThrow(/refusing replay/);
    expect(() =>
      assertNoPendingWork({
        checks: { "spell.cast": { status: "uncertain" } },
      }),
    ).toThrow(/refusing replay/);
    expect(() =>
      assertNoPendingWork({
        stages: { actor: { status: "complete" } },
        checks: {},
      }),
    ).not.toThrow();
  });

  it("checks returned fixture document parent and update identity", () => {
    expect(
      validateWriteResult(
        "create_embedded",
        {
          parentUuid: "Actor.a",
          documentType: "Item",
          data: { name: "Fixture Spell" },
        },
        { uuid: "Actor.a.Item.b", documentName: "Item", name: "Fixture Spell" },
      ),
    ).toBeNull();
    expect(
      validateWriteResult(
        "create_embedded",
        {
          parentUuid: "Actor.a",
          documentType: "Item",
          data: { name: "Fixture Spell" },
        },
        {
          uuid: "Actor.other.Item.b",
          documentName: "Item",
          name: "Fixture Spell",
        },
      ),
    ).toMatch(/not under/);
    expect(
      validateWriteResult(
        "update_document",
        { uuid: "Actor.a.Item.b", data: {} },
        { uuid: "Actor.a.Item.c", documentName: "Item" },
      ),
    ).toMatch(/UUID/);
  });

  it("accepts only a bound confirmed cast and expected resource transition", () => {
    const selection = {
      casterTokenUuid: "Scene.s.Token.t",
      entryUuid: "Actor.a.Item.e",
      spellUuid: "Actor.a.Item.sp",
      rank: 1,
      slotId: null,
      messageMode: "gm",
    };
    const preview = {
      castId: "cast-1",
      resourceBefore: { kind: "rankPool", value: 2, cost: 1 },
    };
    const cast = {
      cast: "confirmed",
      castId: "cast-1",
      actorUuid: "Actor.a",
      spellUuid: selection.spellUuid,
      rank: 1,
      slotId: null,
      messageMode: "gm",
      chatMessageUuid: "ChatMessage.c",
      resourceBefore: preview.resourceBefore,
      resourceAfter: { kind: "rankPool", value: 1, cost: 1 },
    };
    expect(validCastResult(cast, selection, preview, "Actor.a")).toBe(true);
    expect(
      validCastResult(
        { ...cast, actorUuid: "Actor.other" },
        selection,
        preview,
        "Actor.a",
      ),
    ).toBe(false);
    expect(
      validCastResult(
        { ...cast, resourceAfter: { kind: "rankPool", value: 2, cost: 1 } },
        selection,
        preview,
        "Actor.a",
      ),
    ).toBe(false);
  });
});
