import { describe, expect, it } from "vitest";
import { validCurrentPairing } from "../src/companion-pairing";

describe("companion version handshake", () => {
  it("accepts only bounded versions paired on the current socket", () => {
    const socket = {};
    expect(
      validCurrentPairing(socket, socket, {
        type: "paired",
        sessionId: "session",
        runningCompanionVersion: "0.10.0",
      }),
    ).toBe(true);
    expect(
      validCurrentPairing(socket, socket, {
        type: "paired",
        sessionId: "legacy-session",
      }),
    ).toBe(true);
    expect(
      validCurrentPairing({}, socket, {
        type: "paired",
        sessionId: "old",
        runningCompanionVersion: "0.9.1",
      }),
    ).toBe(false);
    expect(
      validCurrentPairing(socket, socket, {
        type: "paired",
        sessionId: "",
        runningCompanionVersion: "0.10.0",
      }),
    ).toBe(false);
    expect(
      validCurrentPairing(socket, socket, {
        type: "paired",
        sessionId: "session",
        runningCompanionVersion: "secret/path",
      }),
    ).toBe(false);
  });
});
