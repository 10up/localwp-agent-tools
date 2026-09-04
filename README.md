# LocalWP Agent Tools

[![Support Level](https://img.shields.io/badge/support-active-green.svg)](#support-level) [![CI](https://github.com/10up/localwp-agent-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/10up/localwp-agent-tools/actions/workflows/ci.yml) [![GPL-2.0-or-later License](https://img.shields.io/github/license/10up/localwp-agent-tools.svg)](https://github.com/10up/localwp-agent-tools/blob/main/LICENSE.md)

> A [Local](https://localwp.com/) add-on that provides an MCP server and project context for AI-powered WordPress development. Works with Claude Code, Cursor, Windsurf, VS Code Copilot, and any MCP client.

## What It Does

When you click "Enable" on a site in Local, the add-on:

1. **Registers the site with the MCP server** — a single HTTP server running in Local's main process that gives AI tools access to WP-CLI, error logs, configuration, and site management
2. **Writes MCP config** (`.mcp.json`, `.cursor/mcp.json`, etc.) — auto-configured with the correct HTTP endpoint and the per-install bearer token for each agent (see [Authentication](#authentication) below)
3. **Generates project context** (`CLAUDE.md`, `.cursorrules`, etc.) — site context including PHP/MySQL versions, active plugins, theme, and file structure
4. **Updates `.gitignore`** — the MCP config files now carry a secret (the bearer token) alongside the generated context files, so all of them are git-ignored and none are committed

Then open the site folder in your AI tool of choice and you're ready to go.

## Architecture

The MCP server runs as a single HTTP server inside Local's Electron main process — no separate Node.js processes per site. Each site gets its own endpoint:

```
http://localhost:{port}/sites/{siteId}/mcp
```

The server uses the MCP Streamable HTTP transport. The port is stable across restarts (persisted at `~/.local-agent-tools/port`, default 24842).

Sites remain registered even when stopped, so the MCP endpoint is always reachable. Tools that need running services (WP-CLI, database) return appropriate errors; file-based tools (config, logs, site info) work regardless. Config is refreshed on each tool call, so starting a site automatically makes database tools work without reconnecting.

## Authentication

Every request to the MCP server needs an `Authorization: Bearer <token>` header. That header is the only channel; there is no `?token=` URL parameter.

The add-on creates the token on first start and stores it at `~/.local-agent-tools/token`, with mode `0600` in a `0700` directory. The token survives restarts, and the server checks it in constant time.

The token lives in a `headers` field inside each generated MCP config file: `.mcp.json`, `.cursor/mcp.json`, `.windsurf/mcp.json`, and `.vscode/mcp.json`. Each of those files is written with mode `0600`, and each file, plus its `.backup` copy, is added to the project's `.gitignore`. The add-on refreshes that `.gitignore` block every time it rewrites the config files, including on startup.

### Upgrading from 0.2.1 or earlier

Restart Local once. On start, the add-on rewrites the MCP config file for every enabled site with the current token, so no manual step is needed.

Then restart your MCP client so it picks up the new config. If a client still gets a 401 response, open the site in Local's Agent Tools panel and click **Regenerate Config**.

### Rotating the token

To replace the current token:

1. Quit Local.
2. Delete `~/.local-agent-tools/token`.
3. Start Local.

The add-on generates a new token on start and rewrites every enabled site's MCP config files with it.

### What the token does not protect against

A process running as the same user as Local can read the token file and every MCP config file that carries it. The token stops other users, other machines, and web pages from reaching the MCP server. It does not stop another process running under your own account.

Treat the MCP server as trusted-local: safe from the network and from other accounts on the machine, but not from other software running as you.

### Install location

Local lets you choose where the add-on writes its project files: Site Root, WordPress Root (`app/public`), or `wp-content`. Choosing WordPress Root or `wp-content` puts the MCP config file, and the token inside it, in the site's web root, where Local's web server can serve it. Prefer Site Root unless you need one of the other locations.

### Host and Origin

The server only answers requests whose `Host` header is exactly `localhost:{port}` or `127.0.0.1:{port}`. A hand-written MCP config must use one of those two values.

## Supported Agents

| Agent           | MCP Config           | Context File                      |
| --------------- | -------------------- | --------------------------------- |
| Claude Code     | `.mcp.json`          | `CLAUDE.md`                       |
| Cursor          | `.cursor/mcp.json`   | `.cursorrules`                    |
| Windsurf        | `.windsurf/mcp.json` | `.windsurfrules`                  |
| VS Code Copilot | `.vscode/mcp.json`   | `.github/copilot-instructions.md` |

## MCP Tools (15 total)

| Category        | Tools                   | Description                                                                                                                                                                                                                          |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **WP-CLI**      | `wp_cli`                | Run any WP-CLI command (database queries, imports, exports, search-replace, plugin/theme management, etc.); blocks destructive commands plus the `--exec`, `--require`, `--ssh`, and `--http` global flags anywhere in the arguments |
| **Logs**        | `read_error_log`        | Read and parse the PHP error log                                                                                                                                                                                                     |
|                 | `read_access_log`       | Read the nginx access log                                                                                                                                                                                                            |
|                 | `wp_debug_toggle`       | Enable/disable WP_DEBUG, WP_DEBUG_LOG, and SCRIPT_DEBUG                                                                                                                                                                              |
| **Config**      | `read_wp_config`        | Parse wp-config.php constants and table prefix; secrets are shown as `[redacted]` by default; `raw: true` requires `includeSecrets: true`                                                                                            |
|                 | `edit_wp_config`        | Add or modify a wp-config.php constant (with backup)                                                                                                                                                                                 |
| **Site**        | `get_site_info`         | Paths, URLs, database config, PHP/WP versions, active plugins and theme                                                                                                                                                              |
|                 | `site_health_check`     | Database connectivity, file permissions, WP_DEBUG status, log sizes, PHP version                                                                                                                                                     |
| **Environment** | `site_start`            | Start a site's services (PHP, MySQL, web server)                                                                                                                                                                                     |
|                 | `site_stop`             | Stop a site's services                                                                                                                                                                                                               |
|                 | `site_restart`          | Restart a site's services                                                                                                                                                                                                            |
|                 | `site_status`           | Get current status of a site                                                                                                                                                                                                         |
|                 | `list_sites`            | List all Local sites with status                                                                                                                                                                                                     |
|                 | `create_site`           | Create a new WordPress site in Local, optionally enabling Agent Tools on it                                                                                                                                                          |
|                 | `list_service_versions` | PHP, database, and web server versions available to `create_site`                                                                                                                                                                    |

### Creating sites

`create_site` drives the same code path as Local's own **Add Site** flow, so a new site gets provisioned services and a real WordPress install:

```
create_site({ name: "Client Redesign", phpVersion: "8.2.29", enableAgentTools: true })
```

Three things to know:

- **It returns before the site is ready.** Provisioning takes a minute or more — longer when Local has to download service binaries first — which is well past most MCP clients' request timeout. The call returns as soon as the site is registered, and `site_status` reports `adding` → `provisioning` → `running`. Poll that until it reports `running`. Pass `wait: true` to block instead, only if your client tolerates long tool calls.
- **Local may ask for the user's password.** Unless Local is set to localhost router mode, provisioning shells out to update `/etc/hosts` and macOS/Windows will prompt for administrator credentials. Site creation is never fully unattended.
- **Failures surface on the next poll.** If provisioning fails after the call returns, `site_status` includes a `creationError` field explaining why.

Omit `phpVersion`, `database` and `webServer` to accept Local's own defaults, or call `list_service_versions` first to see what is available. Versions reported with `installed: false` are downloaded on demand, which makes creation considerably slower.

With `enableAgentTools: true`, Agent Tools is turned on for the site once it finishes provisioning — registering it with the MCP server and writing its MCP config and context files, exactly as clicking **Enable** in the UI does. Use `agents` to pick which ones (defaults to `["claude"]`).

## Installation

### From Source

```bash
git clone <repo-url> agent-tools
cd agent-tools
npm install --legacy-peer-deps
npm run build
```

Copy the built add-on to Local's add-ons directory:

```bash
# macOS
cp -r . ~/Library/Application\ Support/Local/addons/agent-tools/

# Linux
cp -r . ~/.config/Local/addons/agent-tools/

# Windows (PowerShell)
Copy-Item -Recurse -Force . "$env:APPDATA\Local\addons\agent-tools"
```

Install production dependencies in the installed location and restart Local:

```bash
# macOS
cd ~/Library/Application\ Support/Local/addons/agent-tools/

# Linux
cd ~/.config/Local/addons/agent-tools/

# Windows (PowerShell)
cd "$env:APPDATA\Local\addons\agent-tools"
```

```bash
npm install --production --ignore-scripts
# Then restart Local
```

## Development

```bash
# Build the add-on
npm run build

# Watch for changes
npm run watch
```

After building, sync to the installed add-on:

```bash
# macOS
cp -R lib/* ~/Library/Application\ Support/Local/addons/agent-tools/lib/

# Linux
cp -R lib/* ~/.config/Local/addons/agent-tools/lib/

# Windows (PowerShell)
Copy-Item -Recurse -Force lib\* "$env:APPDATA\Local\addons\agent-tools\lib"
```

Then restart Local to pick up changes.

## Project Structure

```
agent-tools/
├── src/                        # Add-on source (TypeScript)
│   ├── main.ts                 # Main process — lifecycle hooks, IPC, MCP server startup
│   ├── renderer.tsx            # Renderer process — React UI
│   ├── mcp-server.ts           # HTTP MCP server — session management, Streamable HTTP transport
│   ├── helpers/
│   │   ├── site-config.ts      # SiteConfig type and SiteConfigRegistry
│   │   ├── paths.ts            # Platform-specific binary resolution (PHP, MySQL, WP-CLI)
│   │   ├── new-site.ts         # Pure helpers for create_site: nicename, domain, and path validation
│   │   └── port.ts             # Stable port allocation with file persistence
│   └── tools/                  # MCP tool implementations
│       ├── index.ts            # Aggregates definitions, routes handleToolCall()
│       ├── wpcli.ts            # wp_cli
│       ├── logs.ts             # read_error_log, read_access_log, wp_debug_toggle
│       ├── config.ts           # read_wp_config, edit_wp_config
│       ├── site.ts             # get_site_info, site_health_check
│       └── environment.ts      # site_start, site_stop, site_restart, site_status, list_sites, create_site, list_service_versions
├── lib/                        # Compiled output
├── package.json
└── tsconfig.json
```

## Requirements

- Local 9.0+
- An MCP-compatible AI tool (Claude Code, Cursor, Windsurf, VS Code Copilot, etc.)

## Platform Support

macOS (darwin-arm64 and darwin-x64), Windows, and Linux.

## Support Level

**Active:** 10up is actively working on this, and we expect to continue work for the foreseeable future including keeping tested up to the most recent version of Local. Bug reports, feature requests, questions, and pull requests are welcome.

## Changelog

A complete listing of all notable changes to Agent Tools are documented in [CHANGELOG.md](https://github.com/10up/localwp-agent-tools/blob/main/CHANGELOG.md).

## Contributing

Please read [CODE_OF_CONDUCT.md](https://github.com/10up/localwp-agent-tools/blob/main/CODE_OF_CONDUCT.md) for details on our code of conduct, [CONTRIBUTING.md](https://github.com/10up/localwp-agent-tools/blob/main/CONTRIBUTING.md) for details on the process for submitting pull requests to us, and [CREDITS.md](https://github.com/10up/localwp-agent-tools/blob/main/CREDITS.md) for a listing of maintainers, contributors, and libraries for Agent Tools.

## Like what you see?

[![Work with the 10up WordPress Practice at Fueled](https://github.com/10up/.github/blob/trunk/profile/10up-github-banner.jpg)](http://10up.com/contact/)
