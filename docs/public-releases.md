# Public Foundry releases

Foundry must fetch a module manifest and ZIP without GitHub authentication. This project's public asset repository is [Tommo999/foundry-vtt-mcp-releases](https://github.com/Tommo999/foundry-vtt-mcp-releases); the development repository remains private. The first public release is v0.8.1. See the [hosting validation report](public-hosting-validation-2026-11-09.md) for publication and anonymous-download evidence; historical validation reports require the full source checkout.

Build local assets after reviewing the release version and required checks:

    npm run release:prepare -- --repository Tommo999/foundry-vtt-mcp-releases

The command builds the workspaces, validates root/workspace/lock/module versions and exact internal dependencies, checks the built module version, then creates **dist/releases/vVERSION/** with:

The checked-in module manifest remains repository-neutral. The helper generates the public URLs into the release manifest and the Windows bundle copy, so do not hard-code a hosting repository in the source template.

- **module.json**, using the stable releases/latest/download/module.json discovery URL.
- **foundry-vtt-mcp.zip**, containing the generated manifest and compiled module.js and module.css; its download URL is pinned to the matching vVERSION GitHub Release.
- **foundry-vtt-windows-setup.zip**, containing the Windows setup bundle with matching public URLs in its embedded manifest. It includes selected TypeScript application sources and maintainer docs, but excludes test trees and historical campaign reports. It is not a complete development checkout.
- **SHA256SUMS.txt**, with hashes for the manifest and both ZIPs.

The local command does not publish, change repository visibility, create Git tags, or overwrite an existing versioned output directory. You can review and publish its assets manually, or use the tag workflow after configuring the required GitHub settings below.

The stable URL discovers the latest normal release; the manifest's ZIP URL remains pinned to that manifest's version. Publish releases in the same repository used to generate the manifest. For testing, use a separate Foundry instance/data directory and optionally a separate release repository; keep the module ID unchanged. Use a specifically selected test manifest rather than a beta channel, which this project does not implement.

These assets package the version in the current source manifest. A release still needs companion installation/update instructions and targeted live compatibility checks; packaging does not establish live compatibility. Keep source and companion versions aligned, and record unavailable live checks as pending.

Existing manual installations may have a source manifest without public update URLs. Installing or updating a release asset once adds the generated manifest metadata; publishing the same version does not cause an existing manual installation to discover the release automatically.

## CI and tag-driven publishing

The CI workflow runs the Node tests, typecheck and build on Node.js 24.15.0. A separate Windows runner requires Windows PowerShell 5.1 and runs the installer parser/smoke test plus Windows archive checks; the PowerShell test is not allowed to silently skip on that runner.

Pushing a tag such as **v0.8.2** or **v0.9.0-rc.1** starts the release workflow. The build job validates the tag against all package, lockfile, module and companion versions, runs tests and typechecking, builds the assets, checks checksums and ZIP manifests, then uploads only the four release files as a private workflow artifact. A separate publish job runs only after build and Windows checks pass.

Configure these settings in the private source repository:

- Optional repository variable **RELEASE_REPOSITORY** selects the public destination; if unset the workflow uses **Tommo999/foundry-vtt-mcp-releases**.
- Repository secret **PUBLIC_RELEASE_TOKEN** must be a fine-grained personal access token with access only to the selected public asset repository and **Contents: read and write**. It is used only in the publish job for the public repository API and GitHub Release operations. The build job receives no publishing secret. Do not use or copy a broad local GitHub CLI credential into Actions.
- Restrict who can create or push **v*** tags to maintainers authorized to publish releases.

The workflow verifies that the destination is public, the tag/release do not already exist, and the candidate stable version is not older than the current latest stable release. It creates the destination tag on the public repository's default-branch commit, never on the private source commit. It creates a draft, uploads the four assets without clobbering, checks remote names/sizes/downloaded hashes and the latest stable version again, and only then publishes. Stable releases are explicitly marked latest; prereleases are published with latest disabled. It uses a checked-in docs/release-vVERSION.md file when present; otherwise it generates bounded release notes.

Publishing is serialized among runs of this source workflow, but GitHub cannot provide a global lock against a separate manual publisher. The release/latest check is repeated just before publishing to narrow that external race. If an upload or verification fails after a public tag or draft is created, the workflow leaves it untouched and blocks reruns for that tag. A maintainer must inspect and reconcile the draft/tag before retrying; there is no automated deletion or overwrite path.

The publication verifier uses the Ubuntu runner's unzip tool to inspect archive listings and bytes without extracting untrusted paths. The Windows setup ZIP is checked for embedded manifest equality and excluded test/history/config paths.
