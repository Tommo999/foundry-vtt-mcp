import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareVersions,
  createPublicTag,
  parseTag,
  preflightRelease,
  verifyReleaseBundle,
  verifyRemoteDraft,
} from "../scripts/release-publication.mjs";

const roots = [];
const repository = "Tommo999/foundry-vtt-mcp-releases";

function writeRawZip(entries, destination) {
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const filename = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(
    destination,
    Buffer.concat([...localParts, centralDirectory, end]),
  );
}

function refreshChecksums(directory) {
  const names = [
    "module.json",
    "foundry-vtt-mcp.zip",
    "foundry-vtt-windows-setup.zip",
  ];
  writeFileSync(
    join(directory, "SHA256SUMS.txt"),
    names
      .map(
        (name) =>
          createHash("sha256")
            .update(readFileSync(join(directory, name)))
            .digest("hex") +
          "  " +
          name,
      )
      .join("\n") + "\n",
  );
}

function bundle({ moduleManifest, windowsManifest } = {}) {
  const root = mkdtempSync(
    join(os.tmpdir(), "foundry-release-publication-test-"),
  );
  roots.push(root);
  const version = "0.8.2";
  const publicManifest = moduleManifest ?? {
    id: "foundry-vtt-mcp",
    version,
    url: "https://github.com/" + repository,
    manifest:
      "https://github.com/" +
      repository +
      "/releases/latest/download/module.json",
    download:
      "https://github.com/" +
      repository +
      "/releases/download/v" +
      version +
      "/foundry-vtt-mcp.zip",
  };
  const output = join(root, "assets");
  mkdirSync(output);
  writeFileSync(join(output, "module.json"), JSON.stringify(publicManifest));
  writeRawZip(
    [
      ["module.json", JSON.stringify(publicManifest)],
      ["module.js", "module bundle"],
      ["module.css", "module styles"],
    ],
    join(output, "foundry-vtt-mcp.zip"),
  );
  writeRawZip(
    [
      [
        "packages/module/module.json",
        JSON.stringify(windowsManifest ?? publicManifest),
      ],
      ["README.md", "setup files"],
    ],
    join(output, "foundry-vtt-windows-setup.zip"),
  );
  const names = [
    "module.json",
    "foundry-vtt-mcp.zip",
    "foundry-vtt-windows-setup.zip",
  ];
  writeFileSync(
    join(output, "SHA256SUMS.txt"),
    names
      .map(
        (name) =>
          createHash("sha256")
            .update(readFileSync(join(output, name)))
            .digest("hex") +
          "  " +
          name,
      )
      .join("\n") + "\n",
  );
  return output;
}

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async json() {
      return body;
    },
  };
}

function githubFetch({
  visibility = "public",
  privateRepo = false,
  existingRelease = false,
  existingTag = false,
  latestTag = null,
  calls = [],
} = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/" + repository)) {
      return response(200, {
        visibility,
        private: privateRepo,
        default_branch: "main",
      });
    }
    if (url.includes("/releases/tags/")) {
      return existingRelease
        ? response(200, { tag_name: "v0.8.2" })
        : response(404, {});
    }
    if (url.includes("/git/ref/tags/")) {
      return existingTag
        ? response(200, { ref: "refs/tags/v0.8.2" })
        : response(404, {});
    }
    if (url.endsWith("/releases/latest")) {
      return latestTag
        ? response(200, { tag_name: latestTag })
        : response(404, {});
    }
    throw new Error("Unexpected GitHub API URL: " + url);
  };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("tagged public release publication gate", () => {
  it("requires exact v-prefixed semantic version tags", () => {
    expect(parseTag("v0.8.2-rc.1")).toMatchObject({
      version: "0.8.2-rc.1",
      prerelease: true,
    });
    expect(parseTag("v0.9.0-1beta").prerelease).toBe(true);
    expect(() => parseTag("v0.9.0-01")).toThrow(/Release tag/);
    expect(() => parseTag("v999999999999999999999.0.0")).toThrow(/Release tag/);
    expect(
      compareVersions("0.9.0-9007199254740992", "0.9.0-9007199254740993"),
    ).toBeLessThan(0);
    expect(() => parseTag("0.8.2")).toThrow(/Release tag/);
    expect(() => parseTag("v0.8.1")).not.toThrow();
    expect(() => parseTag("v0.8.2\n")).toThrow(/Release tag/);
  });

  it("rejects a tag that does not match the manifest version", () => {
    expect(() =>
      verifyReleaseBundle({
        directory: bundle(),
        tag: "v0.8.1",
        repository,
      }),
    ).toThrow(/Manifest version does not match/);
  });

  it("rejects modified assets whose SHA256 no longer matches", () => {
    const directory = bundle();
    writeFileSync(join(directory, "foundry-vtt-mcp.zip"), "tampered");
    expect(() =>
      verifyReleaseBundle({ directory, tag: "v0.8.2", repository }),
    ).toThrow(/Checksum mismatch/);
  });

  it("rejects corrupt ZIP archives", () => {
    const directory = bundle();
    writeFileSync(
      join(directory, "foundry-vtt-windows-setup.zip"),
      "broken zip",
    );
    const files = [
      "module.json",
      "foundry-vtt-mcp.zip",
      "foundry-vtt-windows-setup.zip",
    ];
    writeFileSync(
      join(directory, "SHA256SUMS.txt"),
      files
        .map(
          (name) =>
            createHash("sha256")
              .update(readFileSync(join(directory, name)))
              .digest("hex") +
            "  " +
            name,
        )
        .join("\n") + "\n",
    );
    expect(() =>
      verifyReleaseBundle({ directory, tag: "v0.8.2", repository }),
    ).toThrow(/Could not verify release ZIP/);
  });

  it("rejects a mismatched module ZIP manifest", () => {
    const directory = bundle();
    writeRawZip(
      [
        [
          "module.json",
          JSON.stringify({ id: "foundry-vtt-mcp", version: "0.8.2" }),
        ],
        ["module.js", "module bundle"],
        ["module.css", "module styles"],
      ],
      join(directory, "foundry-vtt-mcp.zip"),
    );
    const files = [
      "module.json",
      "foundry-vtt-mcp.zip",
      "foundry-vtt-windows-setup.zip",
    ];
    writeFileSync(
      join(directory, "SHA256SUMS.txt"),
      files
        .map(
          (name) =>
            createHash("sha256")
              .update(readFileSync(join(directory, name)))
              .digest("hex") +
            "  " +
            name,
        )
        .join("\n") + "\n",
    );
    expect(() =>
      verifyReleaseBundle({ directory, tag: "v0.8.2", repository }),
    ).toThrow(/Module ZIP manifest does not match/);
  });

  it("rejects a Windows ZIP whose embedded manifest differs", () => {
    expect(() =>
      verifyReleaseBundle({
        directory: bundle({
          windowsManifest: {
            id: "foundry-vtt-mcp",
            version: "0.8.1",
          },
        }),
        tag: "v0.8.2",
        repository,
      }),
    ).toThrow(/Manifest version does not match|Windows setup ZIP manifest/);
  });

  it("rejects duplicate ZIP paths and traversal entries without extracting", () => {
    const duplicateModule = bundle();
    const moduleManifest = readFileSync(
      join(duplicateModule, "module.json"),
      "utf8",
    );
    writeRawZip(
      [
        ["module.json", moduleManifest],
        ["module.json", moduleManifest],
        ["module.js", "module bundle"],
        ["module.css", "module styles"],
      ],
      join(duplicateModule, "foundry-vtt-mcp.zip"),
    );
    refreshChecksums(duplicateModule);
    expect(() =>
      verifyReleaseBundle({
        directory: duplicateModule,
        tag: "v0.8.2",
        repository,
      }),
    ).toThrow(/duplicate paths/);

    const traversalWindows = bundle();
    const windowsManifest = readFileSync(
      join(traversalWindows, "module.json"),
      "utf8",
    );
    writeRawZip(
      [
        ["packages/module/module.json", windowsManifest],
        ["../outside.txt", "outside"],
      ],
      join(traversalWindows, "foundry-vtt-windows-setup.zip"),
    );
    refreshChecksums(traversalWindows);
    expect(() =>
      verifyReleaseBundle({
        directory: traversalWindows,
        tag: "v0.8.2",
        repository,
      }),
    ).toThrow(/unsafe traversal path/);
  });

  it("rejects a private release destination before considering publication", async () => {
    await expect(
      preflightRelease({
        directory: bundle(),
        tag: "v0.8.2",
        repository,
        token: "test-token",
        fetchImpl: githubFetch({ visibility: "private", privateRepo: true }),
      }),
    ).rejects.toThrow(/destination must be public/);
  });

  it("requires the explicit public-repository token", async () => {
    let called = false;
    await expect(
      preflightRelease({
        directory: bundle(),
        tag: "v0.8.2",
        repository,
        fetchImpl: async () => {
          called = true;
          return response(200, {});
        },
      }),
    ).rejects.toThrow(/PUBLIC_RELEASE_TOKEN is required/);
    expect(called).toBe(false);
  });

  it("refuses a release or tag that already exists", async () => {
    for (const options of [{ existingRelease: true }, { existingTag: true }]) {
      await expect(
        preflightRelease({
          directory: bundle(),
          tag: "v0.8.2",
          repository,
          token: "test-token",
          fetchImpl: githubFetch(options),
        }),
      ).rejects.toThrow(/already exists/);
    }
  });

  it("permits a prerelease without moving latest and blocks older stable tags", async () => {
    expect(compareVersions("0.8.2-rc.1", "0.8.2")).toBeLessThan(0);
    const prerelease = bundle({
      moduleManifest: {
        id: "foundry-vtt-mcp",
        version: "0.8.3-rc.1",
        url: "https://github.com/" + repository,
        manifest:
          "https://github.com/" +
          repository +
          "/releases/latest/download/module.json",
        download:
          "https://github.com/" +
          repository +
          "/releases/download/v0.8.3-rc.1/foundry-vtt-mcp.zip",
      },
    });
    const allowed = await preflightRelease({
      directory: prerelease,
      tag: "v0.8.3-rc.1",
      repository,
      token: "test-token",
      fetchImpl: githubFetch({ latestTag: "v0.8.2" }),
    });
    expect(allowed).toMatchObject({ prerelease: true, latest: false });
    await expect(
      preflightRelease({
        directory: bundle(),
        tag: "v0.8.2",
        repository,
        token: "test-token",
        fetchImpl: githubFetch({ latestTag: "v0.8.3" }),
      }),
    ).rejects.toThrow(/older than current latest/);
  });

  it("sends the least-disclosure bearer credential only to GitHub API requests", async () => {
    const calls = [];
    await preflightRelease({
      directory: bundle(),
      tag: "v0.8.2",
      repository,
      token: "test-token",
      fetchImpl: githubFetch({ calls }),
    });
    expect(calls.length).toBe(4);
    for (const call of calls) {
      expect(call.init.headers.authorization).toBe("Bearer test-token");
      expect(call.url).toMatch(/^https:\/\/api\.github\.com\/repos\//);
    }
  });

  it("creates the public release tag from the destination default branch, never the private source SHA", async () => {
    let requestBody;
    const tag = await createPublicTag({
      repository,
      tag: "v0.8.2",
      defaultBranch: "main",
      token: "test-token",
      fetchImpl: async (url, init) => {
        if (url.endsWith("/git/ref/heads/main")) {
          return response(200, {
            object: { sha: "a".repeat(40), type: "commit" },
          });
        }
        if (url.endsWith("/git/refs")) {
          requestBody = JSON.parse(init.body);
          return response(201, {
            ref: requestBody.ref,
            object: { sha: requestBody.sha },
          });
        }
        throw new Error("Unexpected GitHub API URL: " + url);
      },
    });
    expect(tag.sha).toBe("a".repeat(40));
    expect(requestBody).toEqual({
      ref: "refs/tags/v0.8.2",
      sha: "a".repeat(40),
    });
  });

  it("does not overwrite a public tag created in a preflight race", async () => {
    await expect(
      createPublicTag({
        repository,
        tag: "v0.8.2",
        defaultBranch: "main",
        token: "test-token",
        fetchImpl: async (url) =>
          url.endsWith("/git/ref/heads/main")
            ? response(200, { object: { sha: "b".repeat(40) } })
            : response(422, { message: "Reference already exists" }),
      }),
    ).rejects.toThrow(/conflicted; no existing tag was replaced/);
  });

  it("checks draft asset identities, sizes and uploaded bytes before publishing", async () => {
    const directory = bundle();
    const localNames = [
      "module.json",
      "foundry-vtt-mcp.zip",
      "foundry-vtt-windows-setup.zip",
      "SHA256SUMS.txt",
    ];
    const fetchImpl = async (url) => {
      if (url.endsWith("/releases/tags/v0.8.2")) {
        return response(200, {
          id: 81,
          tag_name: "v0.8.2",
          draft: true,
          prerelease: false,
          assets: localNames.map((name) => ({
            id: localNames.indexOf(name) + 101,
            name,
            size: readFileSync(join(directory, name)).length,
            url:
              "https://api.github.com/repos/" +
              repository +
              "/releases/assets/" +
              (localNames.indexOf(name) + 101),
          })),
        });
      }
      if (url.endsWith("/releases/latest")) return response(404, {});
      const name = localNames[Number(url.split("/").pop()) - 101];
      const bytes = readFileSync(join(directory, name));
      return {
        status: 200,
        ok: true,
        async arrayBuffer() {
          return bytes;
        },
      };
    };
    await expect(
      verifyRemoteDraft({
        directory,
        tag: "v0.8.2",
        repository,
        token: "test-token",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ draftId: 81 });
    await expect(
      verifyRemoteDraft({
        directory,
        tag: "v0.8.2",
        repository,
        token: "test-token",
        fetchImpl: async (url, init) =>
          url.endsWith("/releases/latest")
            ? response(200, { tag_name: "v0.8.3" })
            : fetchImpl(url, init),
      }),
    ).rejects.toThrow(/older than current latest/);
  });

  it("rejects API-supplied asset URLs before sending credentials to them", async () => {
    const directory = bundle();
    const name = "module.json";
    const local = readFileSync(join(directory, name));
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/releases/tags/v0.8.2")) {
        return response(200, {
          id: 81,
          tag_name: "v0.8.2",
          draft: true,
          prerelease: false,
          assets: [
            "module.json",
            "foundry-vtt-mcp.zip",
            "foundry-vtt-windows-setup.zip",
            "SHA256SUMS.txt",
          ].map((assetName, index) => ({
            id: index + 101,
            name: assetName,
            size: readFileSync(join(directory, assetName)).length,
            url:
              index === 0
                ? "https://attacker.example/collect"
                : "https://api.github.com/repos/" +
                  repository +
                  "/releases/assets/" +
                  (index + 101),
          })),
        });
      }
      throw new Error("Unexpected authenticated request: " + url);
    };
    await expect(
      verifyRemoteDraft({
        directory,
        tag: "v0.8.2",
        repository,
        token: "test-token",
        fetchImpl,
      }),
    ).rejects.toThrow(/download endpoint does not match/);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.authorization).toBe("Bearer test-token");
  });

  it("follows approved GitHub asset redirects without forwarding the token", async () => {
    const directory = bundle();
    const localNames = [
      "module.json",
      "foundry-vtt-mcp.zip",
      "foundry-vtt-windows-setup.zip",
      "SHA256SUMS.txt",
    ];
    const assetCalls = [];
    const fetchImpl = async (url, init) => {
      if (url.endsWith("/releases/tags/v0.8.2")) {
        return response(200, {
          id: 81,
          tag_name: "v0.8.2",
          draft: true,
          prerelease: false,
          assets: localNames.map((name, index) => ({
            id: index + 201,
            name,
            size: readFileSync(join(directory, name)).length,
            url:
              "https://api.github.com/repos/" +
              repository +
              "/releases/assets/" +
              (index + 201),
          })),
        });
      }
      if (url.endsWith("/releases/latest")) return response(404, {});
      assetCalls.push({ url, init });
      if (url.startsWith("https://api.github.com/")) {
        const id = url.split("/").pop();
        return response(
          302,
          {},
          {
            location:
              "https://release-assets.githubusercontent.com/download/" +
              id +
              "?token=signed",
          },
        );
      }
      const id = Number(new URL(url).pathname.split("/").pop());
      const assetName = localNames[id - 201];
      return {
        status: 200,
        ok: true,
        async arrayBuffer() {
          return readFileSync(join(directory, assetName));
        },
      };
    };
    await expect(
      verifyRemoteDraft({
        directory,
        tag: "v0.8.2",
        repository,
        token: "test-token",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ draftId: 81 });
    for (const call of assetCalls) {
      if (call.url.startsWith("https://api.github.com/")) {
        expect(call.init.headers.authorization).toBe("Bearer test-token");
      } else {
        expect(call.url).toMatch(
          /^https:\/\/release-assets\.githubusercontent\.com\//,
        );
        expect(call.init.headers.authorization).toBeUndefined();
      }
      expect(call.init.redirect).toBe("manual");
    }
  });

  it("rejects a draft whose uploaded bytes differ from the verified local assets", async () => {
    const directory = bundle();
    const localNames = [
      "module.json",
      "foundry-vtt-mcp.zip",
      "foundry-vtt-windows-setup.zip",
      "SHA256SUMS.txt",
    ];
    const fetchImpl = async (url) => {
      if (url.endsWith("/releases/tags/v0.8.2")) {
        return response(200, {
          id: 81,
          tag_name: "v0.8.2",
          draft: true,
          prerelease: false,
          assets: localNames.map((name) => ({
            id: localNames.indexOf(name) + 101,
            name,
            size: readFileSync(join(directory, name)).length,
            url:
              "https://api.github.com/repos/" +
              repository +
              "/releases/assets/" +
              (localNames.indexOf(name) + 101),
          })),
        });
      }
      if (url.endsWith("/releases/latest")) return response(404, {});
      const name = localNames[Number(url.split("/").pop()) - 101];
      const local = readFileSync(join(directory, name));
      const bytes = name === "module.json" ? Buffer.from("different") : local;
      return {
        status: 200,
        ok: true,
        async arrayBuffer() {
          return bytes;
        },
      };
    };
    await expect(
      verifyRemoteDraft({
        directory,
        tag: "v0.8.2",
        repository,
        token: "test-token",
        fetchImpl,
      }),
    ).rejects.toThrow(/Uploaded draft asset hash does not match/);
  });
});
