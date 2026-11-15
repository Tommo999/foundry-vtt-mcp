import { describe, expect, it } from "vitest";
import { __spellAuditTest } from "../src/pf2e-spell-audit.js";

const record: any = {
  castId: "cast-1", chatMessageUuid: "ChatMessage.msg-1", casterTokenUuid: "Scene.scene-1.Token.token-1",
  actorUuid: "Actor.actor-1", spellUuid: "Actor.actor-1.Item.spell-1", entryUuid: "Actor.actor-1.Item.entry-1",
  rank: 3, targetTokenUuids: ["Scene.scene-1.Token.target-1"], messageMode: "gm",
};
const evidence = { version: 1, castId: "cast-1" };
function card(overrides: any = {}) {
  const source = {
    speaker: { scene: "scene-1", token: "token-1", actor: "actor-1" },
    whisper: ["gm-1", "gm-2"], blind: false,
    flags: {
      pf2e: { origin: { uuid: record.spellUuid, castRank: 3, variant: { overlays: [] }, rollOptions: ["origin:action:slug:cast-a-spell"] }, casting: { id: "entry-1" } },
      "foundry-vtt-mcp": { spellCast: { castId: "cast-1", targetTokenUuids: record.targetTokenUuids, resourceEvidence: evidence } },
    },
    ...overrides,
  };
  return { uuid: "ChatMessage.msg-1", toObject: () => structuredClone(source), ...source };
}
const ctx: any = { game: { user: { id: "gm-1" }, users: [{ id: "gm-1", isGM: true }, { id: "gm-2", isGM: true }], messages: [] } };

describe("spell audit native card matching", () => {
  it("requires the recorded PF2e cast rank and exact recipient set", () => {
    const message = card();
    ctx.game.messages = [message];
    expect(__spellAuditTest.exactCastMessage(message, record, ctx).ok).toBe(true);
    const wrongRank = card({ flags: { ...message.flags, pf2e: { ...message.flags.pf2e, origin: { ...message.flags.pf2e.origin, castRank: 2 } } } });
    ctx.game.messages = [wrongRank];
    expect(__spellAuditTest.exactCastMessage(wrongRank, record, ctx).ok).toBe(false);
    const wrongVariant = card({ flags: { ...message.flags, pf2e: { ...message.flags.pf2e, origin: { ...message.flags.pf2e.origin, variant: { overlays: ["spell-variant"] } } } } });
    ctx.game.messages = [wrongVariant];
    expect(__spellAuditTest.exactCastMessage(wrongVariant, record, ctx).ok).toBe(false);
  });

  it("rejects broader private recipients and enforces blind visibility", () => {
    const privateMessage = { whisper: ["gm-1", "player-1"], blind: false };
    expect(__spellAuditTest.visibilityMatches(privateMessage, "gm", ctx)).toBe(false);
    expect(__spellAuditTest.visibilityMatches({ whisper: ["gm-2", "gm-1"], blind: true }, "blind", ctx)).toBe(true);
    expect(__spellAuditTest.visibilityMatches({ whisper: ["gm-1"], blind: true }, "blind", ctx)).toBe(false);
    expect(__spellAuditTest.visibilityMatches({ whisper: ["gm-1"], blind: false }, "self", ctx)).toBe(true);
  });
});
