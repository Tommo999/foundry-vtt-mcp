# Installation and setup

## Requirements

- Foundry VTT v14, available to your GM browser over HTTPS. A reverse proxy in front of your Windows Docker host is supported.
- Node.js 22.12 or later on the computer running your AI agent and GM browser.
- `mkcert` to create a locally trusted certificate for the companion's loopback HTTPS service.

The Foundry container does not need a new port. The companion runs on the GM computer, and the Foundry browser tab opens an outgoing secure WebSocket connection to it. Leave that tab open and signed in to the intended world.

### Windows quick setup

Download and extract the [Windows setup bundle](../dist/foundry-vtt-windows-setup.zip) into a writable local folder, then double-click `setup-windows.cmd`. The guided steps, prerequisites and manual Foundry/client configuration are in [Windows setup](windows-setup.md). Use this path instead of the source-checkout steps below.

## Build and install the module

From a source checkout, run `npm install` and `npm run package`. Extract `dist/foundry-vtt-mcp.zip` into Foundry's `Data/modules/foundry-vtt-mcp` directory (the extracted folder must contain `module.json` at its root), restart or refresh Foundry, then enable **Foundry VTT MCP Bridge** in Manage Modules. The module requires Foundry v14 or newer.

## Set up the local companion

Install `mkcert` for your operating system and install its local root certificate once:

- Windows: install `mkcert` using your preferred package manager, then run `mkcert -install` in PowerShell.
- macOS: install with Homebrew (`brew install mkcert`) and run `mkcert -install`.
- Linux: install `mkcert` using the distribution's package manager and run `mkcert -install`. Follow mkcert's platform-specific instructions if the system trust store is not detected.

Build the companion with `npm run build`. From the repository root create a certificate with `mkcert -cert-file localhost.pem -key-file localhost-key.pem localhost 127.0.0.1 ::1`. Find the trusted root certificate directory with `mkcert -CAROOT`; the CA certificate is `rootCA.pem` in that directory. Keep the generated private key private. Initialize the companion with `node packages/companion/dist/cli.js init https://vtt.example.net localhost.pem localhost-key.pem /path/to/rootCA.pem`, replacing the origin and paths with yours. Then run `node packages/companion/dist/cli.js start`. The companion uses port 31415 and binds only to 127.0.0.1. The CA file lets the local MCP CLI verify the companion's localhost certificate. To replace an existing configuration and rotate its pairing token, pass `--force` to `init`; update the token in Foundry afterward.

In Foundry module settings, enter `wss://127.0.0.1:31415/bridge` and the pairing token printed by `init`. The browser must trust the mkcert root CA; do not bypass certificate validation. Create and trust a certificate on each GM computer rather than copying a private key between machines.

## Connect an MCP client

Configure your local MCP client to launch `node` with the absolute path to `packages/companion/dist/cli.js` and the `mcp` argument. For example, a JSON-style MCP configuration looks like this (replace the path):

```json
{
  "mcpServers": {
    "foundry-vtt": {
      "command": "node",
      "args": [
        "C:/path/to/Foundry-VTT-MCP/packages/companion/dist/cli.js",
        "mcp"
      ]
    }
  }
}
```

The companion daemon must already be running. Use `node packages/companion/dist/cli.js status` to check its connection. Keep MCP protocol messages on standard output; diagnostics go to standard error.

## Upgrade from 0.1 to 0.2

Stop the companion with Ctrl+C. From the source checkout, run `npm install` and `npm run package`, then replace the installed module files with the contents of the new `dist/foundry-vtt-mcp.zip`. Reload Foundry in the GM browser, restart the companion with `node packages/companion/dist/cli.js start`, and restart or reconnect the MCP client so it discovers all 18 tools. Keep the existing companion config, certificates and pairing token; do not run `init` or `init --force`. The new GM world setting `MCP asset upload root` defaults to `assets/foundry-mcp`.

## Upgrade from 0.2 to 0.3

Stop the companion with Ctrl+C. From the updated source checkout, run `npm install` and `npm run package`; replace the installed module files from `dist/foundry-vtt-mcp.zip` and reload Foundry in the GM browser. Restart the companion and reconnect or restart the MCP client so it discovers all 24 tools. Keep the existing companion config, certificates and pairing token; do not run `init` or `init --force`. In each PF2e world, confirm the GM-only PF2e integration setting is enabled before using PF2e-specific tools. Foundry/PF2e v0.3 compatibility remains unverified until the manual acceptance checks pass.

## Upgrade from 0.3 to 0.4

Stop the companion with Ctrl+C. From the updated source checkout, run `npm install` and `npm run package`; replace the installed module files from `dist/foundry-vtt-mcp.zip`, reload Foundry in the GM browser, and restart the companion. Restart or reconnect the MCP client so it discovers all 35 tools. Keep the existing companion configuration, certificates and pairing token; do not run `init` or `init --force`. PF2e v0.4 condition, effect and inventory APIs still require live acceptance testing before compatibility claims.

## Upgrade from 0.4 to 0.5

Stop the companion with Ctrl+C. From the updated source checkout, run `npm install` and `npm run package`; replace the installed module files from `dist/foundry-vtt-mcp.zip`, reload Foundry in the GM browser, and restart the companion. Restart or reconnect the MCP client so it discovers all 41 tools. Keep the existing companion configuration, certificates and pairing token; do not run `init` or `init --force`. Encounter preparation creates only inactive, unstarted records; session snapshots are bounded read-only facts. Complete the manual acceptance checks before relying on v0.5 Foundry API compatibility.

## Upgrade from 0.5 to 0.6

Stop the companion with Ctrl+C. From the updated source checkout, run `npm install` and `npm run package`; replace the installed module files from `dist/foundry-vtt-mcp.zip`, reload Foundry in the GM browser, and restart the companion. Restart or reconnect the MCP client so it discovers all 46 tools. Keep the existing companion configuration, certificates and pairing token; do not run `init` or `init --force`. Checks, initiative rolls, encounter start and turn advancement post native Foundry changes and require approval by default. Complete the manual PF2e and encounter acceptance checks before relying on v0.6 live compatibility.

## Upgrade from 0.6 to 0.7

Stop the companion with Ctrl+C. From the updated source checkout, run `npm install` and `npm run package`; replace the installed module files from `dist/foundry-vtt-mcp.zip`, reload Foundry in the GM browser, and restart the companion. Restart or reconnect the MCP client so it discovers all 49 tools. Keep the existing companion configuration, certificates and pairing token; do not run `init` or `init --force`. Use `pf2e_combat_context` to obtain current selectors and expected turn state before each strike or damage roll. Rolls post GM-only chat, require approval, and may invoke native module hooks. Damage is posted for review, without HP application. Complete the manual v0.7 acceptance checks before relying on live compatibility.

## Upgrade from 0.7 to 0.8

Stop the companion with Ctrl+C. From the updated source checkout, run `npm install` and `npm run package`; replace the installed module files from `dist/foundry-vtt-mcp.zip`, reload Foundry in the GM browser, and restart the companion. Restart or reconnect the MCP client so it discovers all 51 tools. Keep the existing companion configuration, certificates and pairing token; do not run `init` or `init --force`. The hidden GM-restricted world setting for damage-application records registers automatically. Use `pf2e_inspect_damage_application`, review its result, and pass the exact review token and choices to `pf2e_apply_damage` after approval. Uncertain applications require manual reconciliation before retry; see the tool reference. Complete live PF2e acceptance checks before relying on compatibility.

## Upgrade from 0.8.0 to 0.8.1

Stop the companion with Ctrl+C. From the updated source checkout, run `npm install` and `npm run package`; replace the installed module files from `dist/foundry-vtt-mcp.zip`, reload Foundry in the GM browser, restart the companion from the updated checkout, and restart or reconnect the MCP client. The release keeps the existing 51 tools and does not require a new pairing token or companion configuration; do not run `init` or `init --force`. Confirm the MCP server reports version 0.8.1 and the Foundry module is loaded at 0.8.1. This update fixes PF2e filtered compendium index searches, makes encounter active-state summaries agree with current-combat checks, and supports native ammunition in inventory read/add/quantity/transfer workflows. Complete the targeted live checks in the [acceptance checklist](acceptance-checklist.md) before relying on these fixes in a campaign.

## Upgrade from 0.8.1 to 0.8.2

1. Stop the companion with Ctrl+C and update the source checkout or extract the matching Windows setup bundle. Keep the existing configuration, certificates and pairing token; do not run `init --force`.
2. For a source installation, run `npm install` and `npm run build` from the repository root. Install the matching module ZIP, using the public Foundry updater after the release is published, or the locally prepared `dist/releases/v0.8.2/foundry-vtt-mcp.zip` for isolated testing. A locally prepared release is not automatically available through GitHub's latest URL.
3. Restart the companion from the updated checkout, hard-refresh the GM browser, reconnect the bridge, and restart/reconnect the MCP client so it discovers all **52 tools**.
4. Call `get_status`. Confirm the loaded module, installed manifest, running companion, MCP client and advertised MCP server all report **0.8.2**, with no mismatch or unverified component. A manifest on disk alone does not prove the running code changed.
5. Complete the v0.8.2 checks in the [acceptance checklist](acceptance-checklist.md) on isolated fixtures before relying on live compatibility. `end_encounter` removes only the explicitly selected current started Combat through native hooks; it preserves Actors, tokens and damage audit records. Inspect and retain tracker information first, and investigate uncertain outcomes before taking further action.

For maintainer CI/tag publication setup, follow [Public releases](public-releases.md). This upgrade introduces no new pairing or TLS configuration.

## Approval controls

New connections start in approval mode. Review each proposed change in Foundry and approve or reject it. The GM may switch to automatic writes for that browser session. Disconnecting, changing worlds or reconnecting ends that session and restores approval mode. Reads do not require approval.

## Troubleshooting

- **Browser reports an insecure connection:** confirm `mkcert -install` ran on the browser computer, the certificate includes localhost, and the companion uses the matching certificate and key.
- **Browser blocks access to the companion:** allow the Foundry site to connect to local network devices if the browser asks for local network access permission, then reconnect the module.
- **Origin rejected:** configure the exact Foundry origin including scheme and port, for example `https://vtt.example.net`.
- **Disconnected / world unavailable:** ensure the GM browser is open in the intended world, the module is enabled, and the companion is running.
- **Module not listed:** check that the installed folder is named `foundry-vtt-mcp` and contains `module.json` at its root.
- **Unsupported tool or mismatched versions:** compare every `get_status.versionDiagnostics` component, restart the companion from the intended checkout, restart the MCP client and hard-refresh the GM browser. Older bridges may return unverified module versions; do not infer that the updated handler ran.
- **CLI status is current but an agent still has old tools:** CLI status describes that CLI invocation. Call `get_status` through the agent's own MCP connection and restart that connection; another running MCP process can still contain an older build.


## Upgrade to 0.9.0

Back up your world and preserve existing damage and spell audit records. Build the source with `npm ci` and `npm run build`, then install the matching locally prepared `dist/releases/v0.9.0/foundry-vtt-mcp.zip` for isolated testing, or the published package when available. Local preparation does not publish a release.

Restart the companion, hard-refresh the GM browser, reconnect the bridge and reconnect the MCP client. Confirm all five version diagnostics report 0.9.0 and discovery exposes 56 tools. A changed manifest alone does not establish that the running builds changed. Follow the [spellcasting guide](spellcasting.md) and complete the unchecked v0.9 live acceptance checks before relying on compatibility. Unresolved spell records block new casts for that Actor and must not be erased to bypass reconciliation.
