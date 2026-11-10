import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { parseRepository } from "./prepare-release.mjs";

const assets = [
  "module.json",
  "foundry-vtt-mcp.zip",
  "foundry-vtt-windows-setup.zip",
  "SHA256SUMS.txt",
];
const hashedAssets = assets.slice(0, 3);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_REDIRECT_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

function fail(message) {
  throw new Error(message);
}

function parseTag(tag) {
  const match =
    typeof tag === "string" &&
    tag.trim() === tag &&
    tag.match(
      /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?$/,
    );
  if (
    !match ||
    ![match[1], match[2], match[3]].every((value) =>
      Number.isSafeInteger(Number(value)),
    )
  )
    fail(
      "Release tag must be vMAJOR.MINOR.PATCH with an optional prerelease suffix.",
    );
  return {
    tag,
    version: tag.slice(1),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Boolean(match[4]),
    prereleaseId: match[4] ?? "",
  };
}

function compareVersions(left, right) {
  const a = parseTag("v" + left);
  const b = parseTag("v" + right);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const aIds = a.prereleaseId.split(".");
  const bIds = b.prereleaseId.split(".");
  for (let index = 0; index < Math.max(aIds.length, bIds.length); index++) {
    if (aIds[index] === undefined) return -1;
    if (bIds[index] === undefined) return 1;
    if (aIds[index] === bIds[index]) continue;
    const aNumeric = /^\d+$/.test(aIds[index]);
    const bNumeric = /^\d+$/.test(bIds[index]);
    if (aNumeric && bNumeric) {
      return BigInt(aIds[index]) < BigInt(bIds[index]) ? -1 : 1;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aIds[index] < bIds[index] ? -1 : 1;
  }
  return 0;
}

function runUnzip(args, archive) {
  const result = spawnSync("unzip", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(
      "Could not verify release ZIP " +
        archive +
        ": " +
        (result.stderr || result.error?.message || "unzip failed").trim(),
    );
  }
  return result.stdout;
}

function zipEntries(path) {
  runUnzip(["-tqq", path], path);
  const rawEntries = runUnzip(["-Z1", path], path)
    .split(/\r?\n/)
    .filter(Boolean);
  const names = rawEntries.map((entry) => entry.replace(/\/$/, ""));
  if (new Set(names).size !== names.length) {
    fail("ZIP contains duplicate paths: " + path);
  }
  if (
    names.some(
      (entry) =>
        entry.startsWith("/") ||
        /^[A-Za-z]:/.test(entry) ||
        entry.includes("\\") ||
        entry.split("/").some((part) => part === ".." || part === "."),
    )
  ) {
    fail("ZIP contains an unsafe traversal path: " + path);
  }
  return names.filter((_, index) => !rawEntries[index].endsWith("/")).sort();
}

function zipText(path, entry) {
  return runUnzip(["-p", path, entry], path);
}

function verifyModuleManifest(manifest, repository, release) {
  const expectedBase = "https://github.com/" + repository;
  if (manifest.version !== release.version) {
    fail("Manifest version does not match the release tag.");
  }
  if (
    manifest.url !== expectedBase ||
    manifest.manifest !==
      expectedBase + "/releases/latest/download/module.json" ||
    manifest.download !==
      expectedBase +
        "/releases/download/" +
        release.tag +
        "/foundry-vtt-mcp.zip"
  ) {
    fail(
      "Manifest public URLs do not match the target repository and release tag.",
    );
  }
}

function verifyChecksums(directory) {
  const text = readFileSync(join(directory, "SHA256SUMS.txt"), "utf8");
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length !== hashedAssets.length) {
    fail(
      "SHA256SUMS.txt must contain exactly the three distributable asset hashes.",
    );
  }
  const parsed = new Map();
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/);
    if (!match || parsed.has(match[2]))
      fail("Malformed or duplicate checksum line.");
    parsed.set(match[2], match[1]);
  }
  if (
    [...parsed.keys()].sort().join("\n") !== [...hashedAssets].sort().join("\n")
  ) {
    fail("SHA256SUMS.txt does not cover the exact expected release assets.");
  }
  for (const name of hashedAssets) {
    const actual = createHash("sha256")
      .update(readFileSync(join(directory, name)))
      .digest("hex");
    if (actual !== parsed.get(name))
      fail("Checksum mismatch for " + name + ".");
  }
}

function verifyReleaseBundle({ directory, tag, repository }) {
  const repo = parseRepository(repository);
  const release = parseTag(tag);
  const files = readdirSync(directory).sort();
  if (files.join("\n") !== [...assets].sort().join("\n")) {
    fail(
      "Release directory must contain exactly the four named public assets.",
    );
  }
  const manifest = JSON.parse(
    readFileSync(join(directory, "module.json"), "utf8"),
  );
  verifyModuleManifest(manifest, repo, release);
  verifyChecksums(directory);

  const moduleZip = join(directory, "foundry-vtt-mcp.zip");
  const moduleEntries = zipEntries(moduleZip);
  if (
    moduleEntries.join("\n") !==
    ["module.css", "module.js", "module.json"].join("\n")
  ) {
    fail(
      "Module ZIP must contain only module.json, module.js and module.css at its root.",
    );
  }
  const embeddedModuleManifest = JSON.parse(zipText(moduleZip, "module.json"));
  if (JSON.stringify(embeddedModuleManifest) !== JSON.stringify(manifest)) {
    fail("Module ZIP manifest does not match the standalone public manifest.");
  }

  const windowsZip = join(directory, "foundry-vtt-windows-setup.zip");
  const windowsEntries = zipEntries(windowsZip);
  const embeddedWindowsManifest = "packages/module/module.json";
  if (
    windowsEntries.filter((entry) => entry === embeddedWindowsManifest)
      .length !== 1
  ) {
    fail("Windows setup ZIP is missing its module manifest.");
  }
  if (
    windowsEntries.some((entry) =>
      /(^|\/)(tests?|fixtures?|reports?|\.git)(\/|$)|(^|\/)(\.env|config\.json|localhost(?:-key)?\.pem)$|live-acceptance|retest/i.test(
        entry,
      ),
    )
  ) {
    fail(
      "Windows setup ZIP contains a test, historical report, or private configuration path.",
    );
  }
  const embeddedWindows = JSON.parse(
    zipText(windowsZip, embeddedWindowsManifest),
  );
  if (JSON.stringify(embeddedWindows) !== JSON.stringify(manifest)) {
    fail(
      "Windows setup ZIP manifest does not match the standalone public manifest.",
    );
  }
  return { ...release, repository: repo, assets: [...assets] };
}

async function requestGitHub(repository, endpoint, token, fetchImpl = fetch) {
  const response = await fetchImpl(
    "https://api.github.com/repos/" + repository + endpoint,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer " + token,
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    fail(
      "GitHub API request failed (" +
        response.status +
        ") for " +
        endpoint +
        ".",
    );
  }
  return response.json();
}

function assertNoConflicts({
  release,
  existingRelease,
  existingTag,
  latestRelease,
}) {
  if (existingRelease)
    fail("A release already exists for " + release.tag + ".");
  if (existingTag)
    fail(
      "A tag already exists in the public repository for " + release.tag + ".",
    );
  assertLatestOrder(release, latestRelease);
}

function assertLatestOrder(release, latestRelease) {
  if (!release.prerelease && latestRelease?.tag_name) {
    const latest = parseTag(latestRelease.tag_name);
    if (compareVersions(release.version, latest.version) < 0) {
      fail(
        "Stable release " +
          release.tag +
          " is older than current latest " +
          latest.tag +
          ".",
      );
    }
  }
}

async function preflightRelease({
  directory,
  tag,
  repository,
  token,
  fetchImpl = fetch,
}) {
  const verified = verifyReleaseBundle({ directory, tag, repository });
  if (typeof token !== "string" || token.length === 0) {
    fail("PUBLIC_RELEASE_TOKEN is required for public-repository preflight.");
  }
  const repo = await requestGitHub(verified.repository, "", token, fetchImpl);
  if (repo?.visibility !== "public" || repo?.private !== false) {
    fail("Release destination must be public and readable anonymously.");
  }
  if (typeof repo.default_branch !== "string" || !repo.default_branch) {
    fail("Release destination did not report a default branch.");
  }
  const tagPath = encodeURIComponent(verified.tag);
  const [existingRelease, existingTag, latestRelease] = await Promise.all([
    requestGitHub(
      verified.repository,
      "/releases/tags/" + tagPath,
      token,
      fetchImpl,
    ),
    requestGitHub(
      verified.repository,
      "/git/ref/tags/" + tagPath,
      token,
      fetchImpl,
    ),
    requestGitHub(verified.repository, "/releases/latest", token, fetchImpl),
  ]);
  assertNoConflicts({
    release: verified,
    existingRelease,
    existingTag,
    latestRelease,
  });
  return {
    ...verified,
    defaultBranch: repo.default_branch,
    latest: !verified.prerelease,
  };
}

async function createPublicTag({
  repository,
  tag,
  defaultBranch,
  token,
  fetchImpl = fetch,
}) {
  const repo = parseRepository(repository);
  parseTag(tag);
  if (typeof token !== "string" || token.length === 0) {
    fail("PUBLIC_RELEASE_TOKEN is required to create the public tag.");
  }
  if (typeof defaultBranch !== "string" || defaultBranch.length === 0) {
    fail("A public destination default branch is required to create its tag.");
  }
  const branch = await requestGitHub(
    repo,
    "/git/ref/heads/" + encodeURIComponent(defaultBranch),
    token,
    fetchImpl,
  );
  const sha = branch?.object?.sha;
  if (!/^[a-f0-9]{40}$/i.test(sha ?? "")) {
    fail("Could not resolve the public repository default-branch commit.");
  }
  const response = await fetchImpl(
    "https://api.github.com/repos/" + repo + "/git/refs",
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer " + token,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "refs/tags/" + tag, sha }),
    },
  );
  if (!response.ok) {
    fail(
      response.status === 422
        ? "Public tag creation conflicted; no existing tag was replaced."
        : "Could not create public tag (" + response.status + ").",
    );
  }
  return { tag, sha, repository: repo };
}

async function verifyRemoteDraft({
  directory,
  tag,
  repository,
  token,
  fetchImpl = fetch,
}) {
  const verified = verifyReleaseBundle({ directory, tag, repository });
  if (typeof token !== "string" || token.length === 0) {
    fail("PUBLIC_RELEASE_TOKEN is required to verify the draft.");
  }
  const release = await requestGitHub(
    verified.repository,
    "/releases/tags/" + encodeURIComponent(tag),
    token,
    fetchImpl,
  );
  if (
    !release ||
    release.tag_name !== tag ||
    release.draft !== true ||
    Boolean(release.prerelease) !== verified.prerelease
  ) {
    fail("The public release is not the expected unpublished draft.");
  }
  const remoteAssets = release.assets;
  if (
    !Array.isArray(remoteAssets) ||
    remoteAssets
      .map((asset) => asset.name)
      .sort()
      .join("\n") !== [...assets].sort().join("\n")
  ) {
    fail("Draft release assets do not match the exact four-file allowlist.");
  }
  for (const asset of remoteAssets) {
    const local = readFileSync(join(directory, asset.name));
    if (
      asset.size !== local.length ||
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0
    ) {
      fail(
        "Draft asset size or download endpoint does not match: " + asset.name,
      );
    }
    const expectedUrl =
      "https://api.github.com/repos/" +
      verified.repository +
      "/releases/assets/" +
      asset.id;
    if (asset.url !== expectedUrl) {
      fail("Draft asset download endpoint does not match: " + asset.name);
    }
    const response = await fetchImpl(expectedUrl, {
      redirect: "manual",
      headers: {
        accept: "application/octet-stream",
        authorization: "Bearer " + token,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      if (response.status < 300 || response.status >= 400) {
        fail(
          "Could not download draft asset for hash verification: " + asset.name,
        );
      }
    }
    const downloaded = Buffer.from(
      await readRedirectedAsset(response, fetchImpl, asset.name),
    );
    const expectedHash = createHash("sha256").update(local).digest("hex");
    const remoteHash = createHash("sha256").update(downloaded).digest("hex");
    if (downloaded.length !== local.length || remoteHash !== expectedHash) {
      fail("Uploaded draft asset hash does not match: " + asset.name);
    }
  }
  const latestRelease = await requestGitHub(
    verified.repository,
    "/releases/latest",
    token,
    fetchImpl,
  );
  assertLatestOrder(verified, latestRelease);
  return { ...verified, draftId: release.id };
}

async function readRedirectedAsset(response, fetchImpl, assetName) {
  let current = response;
  let redirects = 0;
  while (current.status >= 300 && current.status < 400) {
    if (redirects >= 5) {
      fail("Too many redirects while downloading draft asset: " + assetName);
    }
    const location = current.headers?.get?.("location");
    let target;
    try {
      target = new URL(location);
    } catch {
      fail("Invalid GitHub asset redirect for " + assetName + ".");
    }
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.port ||
      target.hash ||
      !ASSET_REDIRECT_HOSTS.has(target.hostname)
    ) {
      fail("Untrusted GitHub asset redirect for " + assetName + ".");
    }
    current = await fetchImpl(target.href, {
      redirect: "manual",
      headers: { accept: "application/octet-stream" },
    });
    redirects++;
  }
  if (!current.ok) {
    fail("Could not download draft asset for hash verification: " + assetName);
  }
  return current.arrayBuffer();
}

async function verifyPublishedRelease({ tag, repository, fetchImpl = fetch }) {
  const repo = parseRepository(repository);
  parseTag(tag);
  const directory = mkdtempSync(
    join(tmpdir(), "foundry-public-release-verify-"),
  );
  try {
    for (const name of assets) {
      const url =
        "https://github.com/" + repo + "/releases/download/" + tag + "/" + name;
      const response = await fetchImpl(url, { redirect: "follow" });
      if (!response.ok) {
        fail("Published asset is not anonymously downloadable: " + name);
      }
      writeFileSync(
        join(directory, name),
        Buffer.from(await response.arrayBuffer()),
      );
    }
    const verified = verifyReleaseBundle({
      directory,
      tag,
      repository: repo,
    });
    return { ...verified, anonymousAssetsVerified: true };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function createReleaseNotes({ projectRoot = root, version, runnerTemp }) {
  const notePath = join(projectRoot, "docs", "release-v" + version + ".md");
  let contents;
  if (existsSync(notePath)) {
    contents = readFileSync(notePath, "utf8");
  } else {
    contents =
      "# Foundry VTT MCP v" +
      version +
      "\n\nThis is a " +
      (version.includes("-") ? "prerelease" : "stable release") +
      " of the Foundry VTT MCP module. See the attached module manifest and archives for installation assets.\n";
  }
  if (Buffer.byteLength(contents, "utf8") > 32 * 1024) {
    fail("Release notes exceed the 32 KiB publication limit.");
  }
  const output = join(runnerTemp, "release-notes-v" + version + ".md");
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(output, contents);
  return output;
}

function writeOutputs(result, notesPath) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(
      output,
      [
        "tag=" + result.tag,
        "repository=" + result.repository,
        "version=" + result.version,
        "prerelease=" + String(result.prerelease),
        "latest=" + String(result.latest),
        "default_branch=" + result.defaultBranch,
        "notes_path=" + notesPath,
      ].join("\n") + "\n",
    );
  }
  console.log(
    "Verified " + result.repository + " " + result.tag + " release assets.",
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const directory = process.env.RELEASE_ASSET_DIR;
    const tag = process.env.RELEASE_TAG;
    const repository = process.env.RELEASE_REPOSITORY;
    if (command === "verify-local") {
      const result = verifyReleaseBundle({ directory, tag, repository });
      console.log("Verified local " + result.tag + " release asset bundle.");
    } else if (command === "preflight") {
      const result = await preflightRelease({
        directory,
        tag,
        repository,
        token: process.env.PUBLIC_RELEASE_TOKEN,
      });
      const notesPath = createReleaseNotes({
        version: result.version,
        runnerTemp: process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? "/tmp",
      });
      writeOutputs(result, notesPath);
    } else if (command === "create-public-tag") {
      const result = await createPublicTag({
        repository,
        tag,
        defaultBranch: process.env.RELEASE_DEFAULT_BRANCH,
        token: process.env.PUBLIC_RELEASE_TOKEN,
      });
      console.log(
        "Created public tag " +
          result.tag +
          " on the destination repository default branch.",
      );
    } else if (command === "verify-draft") {
      await verifyRemoteDraft({
        directory,
        tag,
        repository,
        token: process.env.PUBLIC_RELEASE_TOKEN,
      });
      console.log(
        "Verified draft asset identities, sizes and uploaded hashes.",
      );
    } else if (command === "verify-published") {
      await verifyPublishedRelease({ tag, repository });
      console.log("Verified anonymous downloads for " + tag + ".");
    } else {
      fail(
        "Usage: node scripts/release-publication.mjs <verify-local|preflight|create-public-tag|verify-draft|verify-published>",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export {
  assertNoConflicts,
  assertLatestOrder,
  compareVersions,
  createPublicTag,
  parseTag,
  preflightRelease,
  verifyReleaseBundle,
  verifyPublishedRelease,
  verifyRemoteDraft,
};
