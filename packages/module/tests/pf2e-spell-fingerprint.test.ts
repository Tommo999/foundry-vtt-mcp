import { describe, expect, it } from "vitest";
import {
  canonicalSpellFingerprintValue,
  digestSpellFingerprint,
} from "../src/pf2e-spell-fingerprint";

describe("spell fingerprint encoding", () => {
  it("sorts object keys and preserves array order and scalar encoding", () => {
    expect(
      canonicalSpellFingerprintValue({ b: [true, null, "x"], a: 1 }),
    ).toBe('{"a":1,"b":[true,null,"x"]}');
    expect(canonicalSpellFingerprintValue([1, { z: 0, a: 2 }])).toBe(
      '[1,{"a":2,"z":0}]',
    );
  });

  it("produces the established SHA-256 hex representation", async () => {
    expect(
      await digestSpellFingerprint(
        { b: [true, null, "x"], a: 1 },
        "Secure spell review fingerprints are unavailable.",
      ),
    ).toBe("eca8cfb31ab74533e1eb2f4c74d2d55dfe3c79ac704787e54be8647ea7777eb1");
  });
});
