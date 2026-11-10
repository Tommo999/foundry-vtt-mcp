import companionPackage from "../package.json";
import moduleManifest from "../../module/module.json";
import { describe, expect, it } from "vitest";
import { withMcpVersions } from "../src/cli.js";

describe("MCP status version diagnostics", () => {
  it("reports an old running daemon separately from the new MCP-facing client", () => {
    const result = withMcpVersions({
      ok: true,
      data: {
        versionDiagnostics: {
          versions: {
            compiledModule: moduleManifest.version,
            installedModuleManifest: moduleManifest.version,
            runningCompanion: "0.8.0",
            mcpClient: null,
            mcpServer: null,
          },
        },
      },
    });
    expect(result.data.versionDiagnostics.versions).toMatchObject({
      runningCompanion: "0.8.0",
      mcpClient: companionPackage.version,
      mcpServer: companionPackage.version,
    });
    expect(result.data.versionDiagnostics.mismatches).toContainEqual(
      expect.objectContaining({
        code: "COMPANION_CLIENT_VERSION_MISMATCH",
        expected: "0.8.0",
        actual: companionPackage.version,
      }),
    );
  });

  it("keeps absent legacy module versions unverified instead of guessing", () => {
    const result = withMcpVersions({ ok: true, data: {} });
    expect(result.data.versionDiagnostics.versions.compiledModule).toBeNull();
    expect(result.data.versionDiagnostics.unverified).toContain(
      "compiledModule",
    );
    expect(result.data.versionDiagnostics.unverified).toContain(
      "runningCompanion",
    );
  });
});
