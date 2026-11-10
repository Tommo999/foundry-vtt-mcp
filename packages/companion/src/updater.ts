import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getUpgradeGuidance } from "@foundry-mcp/shared";
import companionPackage from "../package.json";

export const PUBLIC_REPOSITORY = "Tommo999/foundry-vtt-mcp-releases";
export const RELEASE_ASSETS = [
  "module.json",
  "foundry-vtt-mcp.zip",
  "foundry-vtt-windows-setup.zip",
  "SHA256SUMS.txt",
] as const;
const REDIRECT_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const verifierCandidates = () => {
  const here = dirname(fileURLToPath(import.meta.url));
  return [resolve(here, "../../../scripts/release-publication.mjs")];
};
async function readBodyLimited(
  body: ReadableStream<Uint8Array>,
  limit: number,
  message: string,
): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(message);
    }
    chunks.push(value);
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size,
  );
}

function stableTag(tag: unknown): tag is string {
  return (
    typeof tag === "string" &&
    /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)
  );
}
function compareStableVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
async function fetchBounded(
  url: URL,
  expectedHost: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      current.protocol !== "https:" ||
      current.username ||
      current.password ||
      current.port ||
      current.hash ||
      (current.hostname !== expectedHost &&
        !REDIRECT_HOSTS.has(current.hostname))
    )
      throw new Error("Release download URL or redirect was rejected.");
    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: { accept: "application/octet-stream" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 5)
        throw new Error("Release download exceeded the redirect limit.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error(`Release download failed (HTTP ${response.status}).`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes)
      throw new Error("Release asset exceeds the download size limit.");
    return readBodyLimited(
      response.body,
      maxBytes,
      "Release asset exceeds the download size limit.",
    );
  }
  throw new Error("Release download exceeded the redirect limit.");
}
async function latestRelease(fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(
    new URL(
      `https://api.github.com/repos/${PUBLIC_REPOSITORY}/releases/latest`,
    ),
    {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `Could not check the public stable release (HTTP ${response.status}).`,
    );
  if (Number(response.headers.get("content-length")) > 1024 * 1024)
    throw new Error("Public release metadata exceeds the response size limit.");
  if (!response.body)
    throw new Error("Public release metadata response was empty.");
  const metadata = await readBodyLimited(
    response.body,
    1024 * 1024,
    "Public release metadata exceeds the response size limit.",
  );
  let release: any;
  try {
    release = JSON.parse(metadata.toString("utf8"));
  } catch {
    throw new Error("Public release metadata was malformed.");
  }
  if (
    release.draft !== false ||
    release.prerelease !== false ||
    !stableTag(release.tag_name)
  )
    throw new Error("Public latest release is not a valid stable version.");
  if (
    !Array.isArray(release.assets) ||
    release.assets
      .map((asset: any) => asset.name)
      .sort()
      .join("\n") !== [...RELEASE_ASSETS].sort().join("\n")
  )
    throw new Error(
      "Public latest release does not contain the exact expected asset set.",
    );
  return release;
}
function verifyStage(stage: string, tag: string) {
  const script = verifierCandidates().find((candidate) =>
    existsSync(candidate),
  );
  if (!script)
    throw new Error(
      "The local release verifier is unavailable; install the source or Windows setup bundle containing scripts/release-publication.mjs.",
    );
  const result = spawnSync(process.execPath, [script, "verify-local"], {
    cwd: dirname(script),
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      RELEASE_ASSET_DIR: stage,
      RELEASE_TAG: tag,
      RELEASE_REPOSITORY: PUBLIC_REPOSITORY,
    },
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Release bundle validation failed: ${(result.stderr || result.stdout || result.error?.message || "verifier failed").trim()}`,
    );
}
export async function runUpgrade(
  args: string[],
  dependencies: {
    fetchImpl?: typeof fetch;
    verifyStage?: (directory: string, tag: string) => void;
    currentVersion?: string;
  } = {},
): Promise<string> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const stageIndex = args.indexOf("--stage");
  if (args.length && (stageIndex !== 0 || args.length !== 2 || !args[1]))
    throw new Error("Usage: foundry-mcp upgrade [--stage <new-directory>]");
  if (stageIndex < 0) {
    const release = await latestRelease(fetchImpl);
    const current = dependencies.currentVersion ?? companionPackage.version;
    const comparison = compareStableVersions(
      current,
      release.tag_name.slice(1),
    );
    const relation =
      comparison < 0
        ? "Update available"
        : comparison > 0
          ? "This installation is newer than the latest stable release"
          : "This installation is current";
    return `Current companion: ${current}\nLatest stable release: ${release.tag_name}\n${relation}\nRelease notes: https://github.com/${PUBLIC_REPOSITORY}/releases/tag/${release.tag_name}\n\n${upgradeSteps()}\n\nFor a source checkout: git pull --ff-only, npm ci, then npm run build. This command does not change the checkout.`;
  }
  const destination = resolve(args[1]);
  const parent = dirname(destination);
  if (
    destination === parent ||
    destination === resolve("/") ||
    destination === resolve(process.cwd())
  )
    throw new Error("Choose a new dedicated staging directory.");
  if (existsSync(destination))
    throw new Error(
      "Staging destination already exists; choose a new directory.",
    );
  const release = await latestRelease(fetchImpl);
  const currentVersion =
    dependencies.currentVersion ?? companionPackage.version;
  if (compareStableVersions(release.tag_name.slice(1), currentVersion) < 0)
    throw new Error(
      `Refusing to stage older ${release.tag_name} over current ${currentVersion}.`,
    );
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, ".foundry-mcp-upgrade-"));
  try {
    const downloaded = new Map<string, Buffer>();
    for (const name of RELEASE_ASSETS) {
      const asset = release.assets.find(
        (candidate: any) => candidate.name === name,
      );
      const expected = `https://github.com/${PUBLIC_REPOSITORY}/releases/download/${release.tag_name}/${name}`;
      if (asset.browser_download_url !== expected)
        throw new Error(`Public release asset URL was unexpected: ${name}`);
      downloaded.set(
        name,
        await fetchBounded(
          new URL(expected),
          "github.com",
          name === "module.json"
            ? 64 * 1024
            : name === "SHA256SUMS.txt"
              ? 4096
              : MAX_ASSET_BYTES,
          fetchImpl,
        ),
      );
    }
    const checksums = downloaded.get("SHA256SUMS.txt")!.toString("utf8");
    const parsed = new Map(
      [...checksums.matchAll(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/gm)].map(
        (match) => [match[2], match[1]],
      ),
    );
    if (
      checksums.trimEnd().split(/\r?\n/).length !== 3 ||
      [...parsed.keys()].sort().join("\n") !==
        ["foundry-vtt-mcp.zip", "foundry-vtt-windows-setup.zip", "module.json"]
          .sort()
          .join("\n")
    )
      throw new Error("Release checksum file is malformed or incomplete.");
    for (const [name, contents] of downloaded)
      if (
        name !== "SHA256SUMS.txt" &&
        createHash("sha256").update(contents).digest("hex") !== parsed.get(name)
      )
        throw new Error(`Release checksum mismatch: ${name}`);
    for (const [name, contents] of downloaded)
      writeFileSync(join(staging, name), contents, { flag: "wx", mode: 0o600 });
    (dependencies.verifyStage ?? verifyStage)(staging, release.tag_name);
    // Exclusive creation and copy flags prevent replacing any existing path.
    mkdirSync(destination, { recursive: false });
    try {
      for (const name of RELEASE_ASSETS)
        copyFileSync(
          join(staging, name),
          join(destination, name),
          constants.COPYFILE_EXCL,
        );
    } catch (error) {
      throw new Error(
        `Could not finish staging files at ${destination}; the incomplete directory was left for inspection. ${error instanceof Error ? error.message : ""}`,
      );
    }
    return `Verified ${release.tag_name} assets staged at ${destination}. No files were installed or executed.\n\n${upgradeSteps()}\n\nUse the staged Foundry module ZIP for the module update and the Windows setup ZIP for a manual companion update. Existing configuration, certificates, and pairing are preserved when following the in-place setup instructions.`;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
function upgradeSteps() {
  return getUpgradeGuidance([], ["legacy"])
    .steps.map((step, index) => `${index + 1}. ${step}`)
    .join("\n");
}
export { fetchBounded, stableTag };
