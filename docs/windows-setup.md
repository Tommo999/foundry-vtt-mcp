# Windows setup

The Windows bundle prepares the local companion, its trusted loopback TLS certificate, a new pairing token, startup/status scripts, and MCP client configuration examples. It does not edit an MCP client's settings or automate Foundry login.

## 1. Download and run setup

Download the [Windows setup bundle](../dist/foundry-vtt-windows-setup.zip), extract it to a writable local folder, and double-click `setup-windows.cmd`. Keep the extracted folder in place after setup; generated shortcuts and scripts refer to it. Run setup as your normal Windows user. Do not run it from inside the ZIP archive. A local folder is recommended.

The script asks for your Foundry HTTPS origin, such as `https://vtt.example.com`. Enter the origin only, without a path or query string. It uses Windows Package Manager (`winget`) to install Node.js LTS (22.12 or newer) and mkcert when needed. It installs the locked project dependencies and builds the companion/module each time setup runs. Accept the package-manager prompts, Node.js installer/UAC prompts, and mkcert trust-certificate prompt. Node.js installation may require a new terminal window before Windows can find `node` and `npm`; if setup reports that, close the window and run the command file again.

Windows PowerShell 5.1 is included with supported Windows 10 and 11 installations. The launcher applies an execution-policy bypass only to its PowerShell process; it does not change the machine or user execution policy. If an organization policy blocks the script, ask its administrator how to run an approved local script. Do not weaken the organization policy.

If `winget` is unavailable or cannot install a prerequisite, install Node.js 22.12 or newer and mkcert from their official sources, open a new terminal, and rerun setup. Setup stops if the trusted CA or TLS files cannot be validated. It does not disable certificate checks to make the connection work.

## 2. Finish setup in Foundry

Setup creates a private per-user config directory (by default `%APPDATA%\foundry-mcp`) and writes local startup files under its `setup` subfolder. It creates a `Start Foundry MCP` desktop shortcut and opens a companion window. Keep the companion running. To start it later, use that shortcut or run `start-companion.ps1` from the generated setup folder. `check-status.ps1` reports whether it is connected.

In the Foundry world, enable **Foundry VTT MCP Bridge** and set the bridge URL and pairing token shown in `pairing-instructions.txt`. The URL uses the configured port, normally `wss://127.0.0.1:31415/bridge`. Keep the pairing instructions private. The config, private key, and pairing token stay on this Windows user account; do not copy them into the source bundle or share them with another PC. Restart the browser if it does not recognize the newly trusted certificate.

The GM browser and companion need to run on the same computer so the browser can connect to its loopback service. Foundry may remain on a remote server or Docker host: the browser opens an outgoing connection, so the companion does not require a new Foundry-container port or firewall rule. The script does not open ports, install a background service, or automate browser sign-in.

Setup prompts for an optional local Foundry Data folder. If supplied, it installs only the three built module files (`module.js`, `module.css`, `module.json`) under `modules/foundry-vtt-mcp`. The script checks that the target is the `foundry-vtt-mcp` module and backs up any of those existing files before replacing them. It does not modify worlds or other module files. For Foundry on a remote Docker host, copy `dist/foundry-vtt-mcp.zip` to that host, extract it, and copy those three files into the host's Foundry Data `modules/foundry-vtt-mcp` directory.

## 3. Add an MCP client

Setup writes examples to the generated setup folder:

- `foundry-mcp-client.json` contains a generic stdio MCP server entry.
- `foundry-mcp-codex.toml` contains a Codex MCP server snippet.

Add the relevant server entry to your MCP client's settings and preserve its existing entries. If a `foundry-vtt` entry already exists, replace that entry; for Codex, replace the existing `[mcp_servers.foundry-vtt]` table and its `.env` table. Keep unrelated client entries. The setup does not assume which client you use, install a client, or overwrite client configuration. Restart the client after saving its settings. Codex reads MCP server definitions from its TOML configuration; see the [Codex MCP documentation](https://developers.openai.com/codex/mcp/) for the current configuration location and format.

The companion, GM browser, and local stdio MCP client must run on the same Windows computer. The companion binds to loopback, so a client on another computer cannot use this setup's stdio entry.

## Reruns and custom paths

The first successful setup creates a config, certificate pair and pairing token. Rerunning setup keeps an existing valid config, certificate pair and pairing token. It checks that the configured Foundry origin and port agree with any values you provide. It will stop on conflicting settings or invalid TLS files rather than silently rotating a token or changing certificates. Back up the private config folder before repairing it manually.

For managed deployments, the PowerShell script supports `-FoundryOrigin`, `-Port`, `-FoundryDataPath`, `-SkipPrerequisites`, `-NoStart`, `-NonInteractive`, and `-NoDesktopShortcut`. `-NonInteractive` requires `-FoundryOrigin` for a first setup. Set `FOUNDRY_MCP_CONFIG_DIR` before running setup to use a different per-user config directory. Paths containing spaces are supported; keep the extracted source folder and generated config folder accessible to the same Windows user.

## Troubleshooting

Use `node packages/companion/dist/cli.js upgrade` for a read-only stable release check. To stage verified public assets, run `foundry-mcp upgrade --stage <new-directory>` from the extracted source bundle. The directory must be new; staging validates all four assets and does not extract or install them. Use the staged Windows setup ZIP for manual setup and rerun the setup script in place to preserve a valid config, certificates and pairing token. Then restart the companion, hard refresh Foundry as GM, and reconnect the MCP client. `check-status.ps1` reports the same runtime version diagnostics as the CLI.

- **`node`, `npm`, or `mkcert` is not found after install:** close and reopen the command window, then rerun. If package installation failed, install the prerequisite manually and retry.
- **Foundry shows a certificate error:** confirm mkcert trust installation succeeded, keep the generated certificate and key together, and restart the browser. Do not bypass certificate verification. Some browser installations may require their own certificate trust steps.
- **The configured port is already in use:** setup checks for an existing companion and avoids starting a duplicate. If another application occupies the configured port, choose an unused port on the first run and use that same port in the Foundry module settings.
- **Foundry is on another Docker host:** copy `dist/foundry-vtt-mcp.zip` to the host, extract it, then copy `module.js`, `module.css`, and `module.json` into the host's Foundry Data `modules/foundry-vtt-mcp` directory. The local setup cannot access a remote Docker volume unless that directory is mounted on the Windows PC.
- **A prior config conflicts:** do not delete or force-recreate it unless you intend to pair again. Preserve the existing token and certificates, then rerun without conflicting origin/port options.
