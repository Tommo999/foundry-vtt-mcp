import { describe, expect, it } from "vitest";
import { sanitizeData } from "../src/security";

describe("Foundry write sanitization", () => {
  it("blocks permissions, embedded collection injection, and prototype paths", () => {
    for (const input of [
      { ownership: { default: 3 } },
      { "system.__proto__.polluted": true },
      { pages: [{ name: "forged page" }] },
      { items: [{ name: "injected item" }] },
      JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
    ])
      expect(() => sanitizeData(input)).toThrow();
  });

  it("allows safe generic system fields", () => {
    expect(
      sanitizeData({
        name: "NPC",
        system: { details: { biography: "A traveler" } },
      }),
    ).toEqual({
      name: "NPC",
      system: { details: { biography: "A traveler" } },
    });
  });
});
