// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
let api: any;
class MockApplicationV2 {
  render() {}
}
describe("journal page HTML sanitization", () => {
  beforeAll(async () => {
    vi.stubGlobal("Hooks", { once: vi.fn(), on: vi.fn() });
    vi.stubGlobal("foundry", {
      applications: { api: { ApplicationV2: MockApplicationV2 } },
    });
    api = await import("../src/main");
  });
  it("sanitizes both nested and dotted page content updates", () => {
    const nested = api.__test.sanitizeWrite(
      {
        text: {
          content:
            "<p>safe</p><img src=x onerror=alert(1)><script>alert(2)</script>",
        },
      },
      "JournalEntryPage",
    );
    const dotted = api.__test.sanitizeWrite(
      {
        "text.content":
          "<p>safe</p><img src=x onerror=alert(1)><script>alert(2)</script>",
      },
      "JournalEntryPage",
    );
    expect((nested.text as any).content).toContain("<p>safe</p>");
    expect((nested.text as any).content).not.toMatch(/onerror|<script/i);
    expect(dotted["text.content"]).toContain("<p>safe</p>");
    expect(dotted["text.content"]).not.toMatch(/onerror|<script/i);
  });
  it("projects imported actor prototype tokens to safe supported fields", () => {
    const clean = api.__test.sanitizeImported(
      {
        name: "Actor",
        prototypeToken: {
          _id: "private",
          flags: { evil: true },
          name: "Token",
          x: 1,
          actorLink: true,
        },
      },
      "Actor",
    );
    expect(clean.prototypeToken).toEqual({
      name: "Token",
      x: 1,
      actorLink: true,
    });
  });
});
